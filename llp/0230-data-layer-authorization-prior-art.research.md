# LLP 0230: Data-layer authorization — prior art

**Type:** Research
**Status:** Review
**Systems:** Auth, Security/authorization, Storage, Live queries, Code generation, Client integration
**Author:** Charlie Cheever / Claude (Opus 5)
**Date:** 2026-08-10
**Revised:** 2026-08-12
**Related:** LLP 0011, LLP 0022, LLP 0039, LLP 0053, LLP 0056, LLP 0082, LLP 0084, LLP 0085, LLP 0116, LLP 0170, LLP 0172, LLP 0212, LLP 0214, LLP 0226, LLP 0227, LLP 0231

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
change. The incremental-view-maintenance line engages with that *structurally*;
every shipping live-query system surveyed evades it instead, by not retaining a
decision — InstantDB re-evaluates per object, Supabase per WAL change per
subscriber, Hasura by re-running the whole composed query on a one-second
refetch timer, and Zero by re-transforming on connection events plus a
revalidation interval that ships disabled. The first of those is the shape
InstantDB's own vendor flagged as inadequate (Finding 1); the 2026-08-12
reading pass found the others to be the same structural choice under better
amortization. Adopting any single system wholesale is still not available: this
is a join of two literatures that have mostly not met.

A third finding was added by that reading pass, and it governs the field-masking
sibling spec. **Field-level masking applied at projection time is not a
boundary, and this is settled empirically rather than argued.** Microsoft and
Oracle say so in their own documentation about their own products; SurrealDB
implemented conditional per-field read permissions and had them bypassed six
documented ways through indexes, counters, error text, traversals, patch
operations. Tier 5 is that record.

## Question and scope

> What has the field learned about enforcing authorization at the data-access
> layer rather than at the endpoint, and which of it transfers to a system with
> durable live subscriptions?

Out of scope: recommending a design; re-surveying sync engines (LLP 0022, 0082,
0084, 0085, 0116 already do that); credential and session mechanics (LLP 0039,
0212, 0214, 0226, 0227).

One qualification on "recommending a design," added 2026-08-12. Tier 5 was read
to inform a specific sibling spec, and it is organized for that reader: where it
says a spec "should" do something, it is mapping the empirical record onto
clauses LLP 0231 has **already pinned**, not choosing between open alternatives.
Those statements carry no decision authority — the spec decides, under its own
review. Read them as "the record supports X," and treat any place Tier 5 appears
to settle a question 0231 left open as a defect in this document.

## Finding 0 — the coverage gap

| Topic | Documents mentioning it, before this one |
| --- | ---: |
| Zanzibar | **1** — in LLP 0056's *non-goals* |
| SpiceDB / OpenFGA / Ory Keto / Permify | 0 |
| AWS Cedar | 0 |
| Noria | 0 |
| Firebase Security Rules | 0 (one passing vendor-table mention in LLP 0139) |
| OPA / Rego | 0 |
| Column privileges / masking / field-level enforcement | 0 |

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
**explicitly deprecated**. Both halves matter: the shape it chose, and the
reasons it was retired.

The 2026-08-12 reading pass confirms the shape and corrects three things the
round-2 reviewer reported from memory.

**The shape is confirmed, including a detail that matters for class M.** Zero's
[deprecated-RLS page](https://zero.rocicorp.dev/docs/deprecated/rls-permissions)
documents rules written as ZQL through `definePermissions`, covering `select`,
`insert`, `update`, and `delete`, with "If you don't specify any rules for an
operation, it is denied by default"; the ruleset is compiled to JSON at build
time into a `{ZERO_APP_ID}.permissions` table in the upstream database, which
replicates live to `zero-cache`, where the rules are parsed and applied to
every operation. Column-level control was **planned and never shipped** — the
page states "Permissions are currently row based. Zero will eventually also
have column permissions," and a callout adds "**Column permissions are not
currently supported**: Select permission applies to every column. The
recommended approach for now is to factor out private fields into a separate
table, e.g. `user_private`. Column permissions are planned but currently not a
high priority." Zero is therefore *not* precedent for field masking, only for
row scoping.

**Correction — the deprecation rationale is not published where the reviewer
implied.** The deprecated-RLS page carries only the notice "🧟 **This API is
deprecated**: It will be removed in a future release of Zero," with a pointer
to the current permissions documentation and no stated reasons. The 0.15
release notes were not the removal point and were not re-read for this pass.
The removal is recorded in
[Zero 0.25](https://zero.rocicorp.dev/docs/release-notes/0.25): "There are no
longer first-class auth or permission systems" — and, a fact the survey did not
carry, 0.25 also collapsed the query kinds: "There are no longer ... synced
queries and zql queries." Zero's current
[auth page](https://zero.rocicorp.dev/docs/auth) states the posture directly:
"Zero does not have (or need) a first-class permission system like RLS." So the
*fact* of retirement is verified and the *reasons* remain unverified by us.

**Correction — the survey is stale by a major version line.** Zero's
[release-notes index](https://zero.rocicorp.dev/docs/release-notes) runs
through 1.x. Treating "0.25's split" as the current state understates how
settled the retirement is; 0.25 is the removal commit, not the frontier.

**Confirmed, and sharper than reported — the out-of-band revocation answer is a
timer that is off by default.** `zero-cache` exposes
`auth-revalidate-interval-seconds` (`ZERO_AUTH_REVALIDATE_INTERVAL_SECONDS`),
documented in the
[zero-cache config](https://zero.rocicorp.dev/docs/zero-cache-config) as "How
often `zero-cache` re-checks that each live connection is still authorized to
use your `/query` endpoint," with the stated purpose "to bound how long
already-open connections can continue after logout, session expiry, token
revocation, or other server-side auth changes that happen without a reconnect."
Its **default is unset**. Token-driven re-transform is confirmed separately:
the auth page describes `zero.connection.connect({auth: nextToken})` as
refreshing server-side auth context and re-transforming queries without
reconnecting.

That last finding is the load-bearing one for LLP 0231's D4. The closest living
relative of our constraints answers out-of-band revocation with an **opt-in
polling interval, disabled unless configured** — not with an invalidation edge.
It is a bounded-staleness answer, not a correctness one, and it is the best
shipped answer in this tier. Any use of this section should still distinguish
four change classes: relational permission-data changes, auth-context changes,
policy-code deployment, and the retired live-replicated policy-table mechanism.

*Confidence: high on the mechanism facts,* read from Zero's documentation
2026-08-12 and linked inline. *Low on the deprecation rationale,* which is not
published on the pages we read.

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
round-2 review families. The 2026-08-12 pass read Hasura's documentation and
**confirms the composition claim, corrects the lifetime claim, and downgrades
the column-level claim.**

**Confirmed — composition, not post-filtering.** Hasura's
[permissions overview](https://hasura.io/docs/2.0/auth/authorization/permissions/)
states it plainly: "Hasura converts incoming GraphQL requests into a single SQL
query which includes constraints derived from the permission rules that is
executed on the configured database instance."
[Row permissions](https://hasura.io/docs/2.0/auth/authorization/permissions/row-level-permissions/)
are boolean expressions over static values, session variables
(`X-Hasura-User-Id`), and operators, with logical `_and`/`_or`/`_not`, and they
may reference related tables through relationships, remote relationships across
databases, and unrelated tables via `_exists`. That is a shipped, relationship-
aware, session-parameterized predicate compiled into the plan — the exact move
LLP 0231's D3 proposes for class R, in production.

**Confirmed, and stronger than the survey said — enforcement is also
schema-shaped.** Per
[roles and session variables](https://hasura.io/docs/2.0/auth/authorization/roles-variables/):
"For every role that you create, Hasura automatically publishes a different
GraphQL schema that represents the right fields, queries and mutations that are
available to that role so that users with that role will only see a schema
which they are able to access." A restricted field is absent from the role's
schema, not nulled in its responses — a *refusal* locus rather than a masking
locus (see the field-enforcement section below for why that distinction is the
whole ballgame).

**Correction — the decision-lifetime claim was too generous.** Hasura's
[live-query execution](https://hasura.io/docs/2.0/subscriptions/postgres/livequery/execution/)
does not incrementally invalidate a retained decision. It **re-executes the
whole multiplexed query on a refetch timer**, documented with a default
subscription refetch interval of 1 second, batching similar subscriptions into
one SQL query (default multiplexed batch size 100, via
`HASURA_GRAPHQL_LIVE_QUERIES_MULTIPLEXED_BATCH_SIZE`) and grouping subscribers
into "cohorts" that "share the same session and query variables." Multiplexing
requires matching roles and identical selection sets differing only in scalar
argument values. So Hasura gets permission-change freshness **for free, bounded
by the poll interval, by not retaining a decision at all** — the same structural
answer as Supabase and InstantDB, differently amortized. It dissolves the
lifetime question rather than answering it. That is still a useful precedent,
but it is a bounded-staleness precedent, not an invalidation one.

**Correction — "the only production system here with a column-level surface" was
wrong.** It is the only *live-query* system here with one; the field-enforcement
section below surveys four production column-level mechanisms (SQL Server,
Oracle, Snowflake, BigQuery) that the survey had not read. Hasura's own
[column permissions](https://hasura.io/docs/2.0/auth/authorization/permissions/column-level-permissions/)
are an allow-list — they "determine which columns are accessible in the rows
which are accessible" — not a conditional per-row mask, so they do **not** express
pointing-room's `revealed || owner` shape and are not precedent for class M's
grammar. They are precedent for class M's *fail-closed projection*.

**Unverified.** Whether a column omitted from a role's select permission can
still be referenced in that role's `where` or `order_by` arguments. The per-role
schema statement implies structural exclusion, but no Hasura page we read says
so, and we did not test it. This is the single most important open fact about
Hasura for 0231's noninterference requirement.

*Confidence: high on the quoted mechanisms,* read from Hasura's documentation
2026-08-12 and linked inline. *Unverified* on the `where`/`order_by`
interaction, and on policy-metadata activation, offline retention, and
revocation delivery, which we did not reach.

### Supabase Realtime (WALRUS) — the brute-force shape, second instance

Confirmed on a fresh read, and now quantified. WALRUS — Write Ahead Log
Realtime Unified Security — is a Postgres function Supabase invokes per WAL
record. Per
[Supabase's engineering write-up](https://supabase.com/blog/realtime-row-level-security-in-postgresql),
for each change it identifies the source table and action, looks up the
subscribers to that table, **assumes the identity of each subscriber**, and
checks visibility, returning the authorized subscriber list to the realtime
server. Visibility is therefore determined individually, per subscriber, per
change.

Two details refine the "brute force" framing. First, the per-subscriber check is
an *indexed primary-key re-read under the subscriber's role* (`where id = 806`),
wrapped in prepared statements to skip planning — not arbitrary policy code over
each returned object, which is InstantDB's shape. Second, the cost is published:
processing time per record scales linearly with subscriber count, at **11.2 ms
for 1 subscriber, 64.7 ms for 1,000, and 303.8 ms for 10,000**.

That is the corroboration Finding 1 wanted, and it is stronger than a
self-report: a second production system, an explicitly different implementation
strategy, and a measured linear-in-subscribers cost curve. The shape is what
LLP 0231's D3 is avoiding, and this is the number to cite when saying why.

*Confidence: high.* Read from Supabase's published write-up 2026-08-12; the
figures are the vendor's own benchmark, and we have not reproduced them.

### OPA data filtering and Oso — compiled policy fragments

The first revision listed OPA as a corpus gap but never surveyed it, and S1 of
the sibling RFC over-generalized from that silence. The 2026-08-12 pass
confirms the structural claim and **withdraws the refusal claim as unverified**.

**Confirmed — the Compile API compiles to SQL.** OPA's
[REST API reference](https://www.openpolicyagent.org/docs/rest-api#compile-api)
documents partial evaluation ("The Compile API allows you to partially evaluate
Rego queries and obtain a simplified version of the policy") and a
`POST /v1/compile/{path:.+}` endpoint that emits SQL filters selected by
`Accept` header — `application/vnd.opa.sql.{sqlserver,mysql,postgresql,sqlite}+json`
— plus a dialect-agnostic UCAST form.

**Confirmed — the admissible fragment is explicitly closed and documented.**
[Writing valid Data Filtering Policies](https://www.openpolicyagent.org/docs/filtering/fragment)
enumerates it: comparisons (`==`, `!=`, `<`, `>`, `<=`, `>=`) between unknowns
(columns) and knowns, with unknowns permitted on both sides for SQL targets;
`startswith`, `endswith`, `contains`, and `k in ...` (but not `k, v in ...`),
with unknowns only on the left; rules and functions subject to restrictions; and
explicit exclusions — "`every` may not be used with unknown values," "default
rules (or functions) may not be used in combination with unknown values,"
`not` combined with plain unknowns or rule references, and other built-ins with
unknown values. This is precisely the structure LLP 0231's grammar question
needs: **an open authoring language with a separately specified, closed,
pushdown-compilable subset**, published as a document an author can read before
writing.

**Correction — the "refuses rather than falls back" half is unverified.** The
fragment page states what is *valid*; neither it nor the REST reference states
what the Compile API does when a policy falls outside the fragment. The only
adjacent documented behaviour is unrelated: non-deterministic built-ins such as
`http.send` are "*not evaluated* during PE" unless `nondeterministicBuiltins` is
set. Do not cite OPA as precedent for generate-time refusal until that
behaviour is checked.

**Oso was not read this pass.** The claim that Oso's data-filtering performs the
same compile-into-predicates move remains reviewer-reported and unverified by
us.

*Confidence: high on the Compile API and the fragment,* read and linked
2026-08-12. *Unverified* on out-of-fragment behaviour and on Oso.

## Tier 2 — authorization systems proper

### Zanzibar (USENIX ATC 2019)

The field's canonical paper: relation tuples, userset rewrite rules, and a
consistency mechanism for a globally distributed ACL store. Attribution
verified 2026-08-12 from
[Google Research's landing page](https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/):
Ruoming Pang, Ramon Caceres, Mike Burrows, Zhifeng Chen, Pratik Dave, Nathan
Germer, Alexander Golynski, Kevin Graney, Nina Kang, Lea Kissner, Jeffrey L.
Korn, Abhishek Parmar, Christina D. Richards, and Mengzhi Wang, USENIX ATC '19.
The PDF is at `https://www.usenix.org/system/files/atc19-pang.pdf`, which
returned 403 to our fetcher, so quotations below the abstract level were not
re-verified this pass.

**The part that transfers is the "new enemy problem."** Change an ACL and change
content concurrently and a reader can observe new content under the stale ACL.
The abstract — the level we could re-read this pass — claims decisions that
"respect causal ordering of user actions and thus provide external consistency
amid changes to access control lists and object contents." *The paper's body
statement of the problem, that preventing it "requires Zanzibar to understand
and respect the causal ordering between ACL or content updates, including
updates on different ACLs or objects and those coordinated via channels
invisible to Zanzibar," is carried over and was not re-read verbatim this
pass* — see the 403 above. Note that it is ACL **or content** updates: the
content half is what makes the phenomenon work.
Zanzibar's answer is the **zookie**: an opaque token naming a consistency point,
so a read can demand "evaluate no earlier than this." *The zookie mechanics are
carried over from the previous revision and were not re-read verbatim this
pass* — see the 403 above.

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
policy zones** work. The 2026-08-12 pass read the source and **the hedge was
right, and should be tightened rather than softened.**

Meta's stated complaint about the prior approach is *operational*, not
correctness: per its
[purpose-limitation post](https://engineering.fb.com/2024/08/27/security/privacy-aware-infrastructure-purpose-limitation-meta/),
"The combination of point checking and data lineage, while viable at a small
scale, leads to significant operational overhead as point checking still
requires auditing many individual assets," and information flow control "offers
a more durable and sustainable approach by controlling not only data access but
also how data is processed and transferred in real-time, rather than relying on
point checking or out-of-band audits." A follow-up post covers
[policy zones in batch processing](https://engineering.fb.com/2025/07/23/security/policy-zones-meta-purpose-limitation-batch-processing-systems/).

So Meta says point checking *does not scale to audit*, at exabyte scale, for
*purpose limitation*. It does not say per-load authorization is incorrect, and
it is not evidence that Ent's shape failed. Reading it as a verdict on
Ent-style per-load authorization is this document's inference, and a weaker one
than the previous revision implied. The move is to data-flow-level enforcement:
annotate data with policy zones, track propagation between systems.

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

**Data Flow Control / Passant** — the citation checks out and the gloss needed
sharpening. [arXiv 2606.05679](https://arxiv.org/abs/2606.05679) resolves to
*Data Flow Control: Data Safety Policies for AI Agents*, Charlie Summers and
Eugene Wu, submitted 4 June 2026 — so the ID, the date, and the Passant
attribution in the previous revision were all correct. A companion vision paper
is [arXiv 2512.05374](https://arxiv.org/abs/2512.05374), *Please Don't Kill My
Vibe: Empowering Agents with Data Flow Control*, Summers, Haneen Mohammed, and
Wu, December 2025.

Read from the [full text](https://arxiv.org/html/2606.05679): a DFC policy is
`P = (S, BA, F)` — a set of source relations, an aggregate constraint over the
provenance of an output tuple, and a resolution function — so it is genuinely
tuple-level and genuinely about *derivation*, not projection. Passant's
contribution is the "Full-Push" rewrite, which propagates semiring annotations
through the plan so policy aggregates are evaluated inline during ordinary
execution, avoiding the materialized-provenance cost the paper puts at
20%–10,000×.

**Two corrections to the previous gloss.** First, "broader than authorization"
undersells the mismatch: the paper's motivating setting is *AI agents* writing
SQL, and — our reading, not an assumption the paper states explicitly — its
threat model treats the query structure itself as trusted, which
is not our setting, where the query is the adversary's instrument. Second, and
more limiting, the paper scopes itself to **monotonic SQL-92**: "we leave
extending DFC to non-monotonic constructs (e.g., negation, recursion) as an
important next step." Negation, difference, and windowing are out. A class-M
mask condition is naturally disjunctive and often negated, so this line is a
framing to steal from, not a mechanism to lower onto.

*Confidence: high on attribution, scope, and the stated limitation,* read
2026-08-12. *Medium* on whether the rewrite technique transfers; we have not
assessed it against our matcher.

## Tier 5 — field- and column-level enforcement

Round-2 review exposed a structural hole — the survey contained no
field/column-level enforcement prior art at all — and LLP 0231 deferred its
class-M grammar to a sibling spec *because* of that hole. This tier is the
reading that closes it, done 2026-08-12 against vendor documentation, the
SQL standard's implementations, published security advisories, and the
statistical-disclosure-control line. It is organized for a spec author:
mechanism, stated limits, design lesson.

The one-sentence result: **every production system that masks a field at
projection time and leaves the raw value reachable elsewhere in the plan has
been shown to leak it**, and the systems that do not leak achieve that by
refusing the query or by masking at every reference — never by nulling the
output alone. LLP 0231 §D3's noninterference clause is not a conservatism
premium. It is the minimum that the empirical record supports.

### 5.1 — three shapes, and only three

Everything below is one of three answers to "a reader may not see this field."

| Shape | What the reader gets | Systems |
| --- | --- | --- |
| **Refusal** | an error naming the restriction | SQL column privileges; BigQuery column-level security; Hasura per-role schema |
| **Mask at every reference** | a masked value wherever the column appears, including predicates | Snowflake masking policies |
| **Mask at projection** | the row, with the cell nulled or obfuscated | SQL Server DDM; Oracle Data Redaction; BigQuery data masking; SurrealDB field permissions; the GraphQL null-field convention |

The third shape is the one LLP 0231's class M resembles, and it is the one with
the documented failures. Read §5.4 before choosing it.

### 5.2 — SQL column privileges: the standard, and what it is not

PostgreSQL's `GRANT SELECT (col) ON tbl` is the standard's answer, and its
[privilege reference](https://www.postgresql.org/docs/current/ddl-priv.html)
states the semantics that matter: `SELECT` "Allows `SELECT` from any column, or
specific column(s), of a table, view, materialized view, or other table-like
object. Also allows use of `COPY TO`. **This privilege is also needed to
reference existing column values in `UPDATE`, `DELETE`, or `MERGE`.**"

The emphasized clause is the whole design. A column privilege is a **reference**
privilege, not a projection filter: you need it to *touch* the value, not merely
to return it. A query that mentions an unprivileged column in a `WHERE`,
`ORDER BY`, `JOIN`, or aggregate position fails rather than silently returning
something. That is refusal, and it is why column privileges have no side-channel
literature to speak of.

What they do **not** protect against, and why they cannot carry class M alone:

- **No condition.** The grant is static per role. There is no way to say
  "disclosed when `rounds.revealed` or when the caller owns the row." Every
  conditional-disclosure product in this tier exists because the standard
  mechanism cannot express a condition.
- **Grants do not subtract.** Per
  [`GRANT`](https://www.postgresql.org/docs/current/sql-grant.html): "A user may
  perform `SELECT`, `INSERT`, etc. on a column if they hold that privilege for
  either the specific column or its whole table. Granting the privilege at the
  table level and then revoking it for one column will not do what one might
  wish: the table-level grant is unaffected by a column-level operation." A
  field-level fence built on additive grants is only as good as the discipline
  that never issues the table-level grant — which is exactly the omission hazard
  LLP 0231's D2 fail-closed field addition exists to remove.

*Design lesson.* Refusal-on-reference is the strongest available field
semantics and it is cheap, because the check happens where the name is
resolved rather than where the value is produced. LLP 0231's generate-time
refusal for interfering positions is the same move, moved earlier.

*Confidence: high.* Read from PostgreSQL's documentation 2026-08-12.

### 5.3 — dynamic data masking: four vendors, two designs

**SQL Server Dynamic Data Masking — the vendor says it is not a boundary.**
Microsoft's
[DDM documentation](https://learn.microsoft.com/en-us/sql/relational-databases/security/dynamic-data-masking?view=sql-server-ver16)
is unusually candid, and this is the sentence to cite whenever someone proposes
projection-only masking as a security control: "Dynamic data masking doesn't aim
to prevent database users from connecting directly to the database and running
exhaustive queries that expose pieces of the sensitive data." It carries a
section titled **"Security Note: Bypassing masking using inference or
brute-force techniques"** with a worked attack —

```sql
SELECT ID, Name, Salary FROM Employees
WHERE Salary > 99999 and Salary < 100001;
```

— which returns the matching employees with `Salary` displayed as `0`. The
predicate is evaluated against the true value; only the projection is masked.
Microsoft's conclusion: DDM "shouldn't be used alone to fully secure sensitive
data from users running ad hoc queries on the database. It's appropriate for
preventing accidental sensitive data exposure, but doesn't protect against
malicious intent to infer the underlying data."

Three further documented behaviours are directly instructive:

- **Masking is contagious through projected expressions, and lossy about
  which mask.** "Whenever you project an expression referencing a column for
  which a data masking function is defined, the expression is also masked.
  Regardless of the function ... used to mask the referenced column, the
  resulting expression will always be masked with the default function." So
  derived output *is* covered on the projection path — which shows the vendor
  understood derivation and covered exactly one of its positions.
- **Masking does not restrict writes.** "Creating a mask on a column doesn't
  prevent updates to that column." Read masking and write authorization are
  independent, which LLP 0231's D3 also assumes.
- **Cross-database comparison silently returns wrong answers.** Queries
  spanning instances "and involve any kind of comparison or join operation on
  MASKED columns don't provide correct results," because the remote side
  returns already-masked values. This is the mask-at-reference semantics
  arriving by accident, and it is documented as a defect.

**Oracle Data Redaction — same design, same disclaimer, better worked
example.** Oracle's
[general security guidelines](https://docs.oracle.com/en/database/oracle/oracle-database/23/dbred/oracle-data-redaction-general-security-guidelines.html)
state: "Oracle Data Redaction is not intended to protect against users who run
ad hoc SQL queries that attempt to determine the actual values by inference.
Inference refers to the process that is designed to find actual data by
repeatedly trying queries." Their example is the clearest statement in any
vendor documentation of the ordering channel:

```sql
SELECT FIRST_NAME, LAST_NAME, SALARY FROM HR.EMPLOYEES
WHERE SALARY > 16000 ORDER BY SALARY DESC;
```

Every `SALARY` comes back `0`, and the rows come back in true salary order. The
attacker learns the ranking exactly, and binary-searches the values with the
predicate. Oracle also documents that Data Redaction is not enforced for
`SYSDBA`.

**Snowflake — the other design: mask at every reference.** Snowflake's
[column-level security introduction](https://docs.snowflake.com/en/user-guide/security-column-intro)
applies a masking policy to a column "regardless of where in a SQL expression
the column is referenced, including: Projections. JOIN predicates. WHERE clause
predicates. ORDER BY and GROUP BY clauses." That closes the Oracle and SQL
Server channels by construction — and Snowflake states the price honestly: "if
executing a query results in masked data in one or more columns, the query
output may not provide the anticipated value because the masked data prevents
evaluating all of the query output data in the desired context." A
`WHERE email = 'a@b.com'` compares the *masked* value to the literal and matches
nothing. Snowflake also forbids a column appearing in both a masking policy
signature and a row access policy signature.

This is the single most important trade in the tier. **Noninterference is
purchasable, and Snowflake's price for it is semantic surprise: queries that
silently return the wrong rows.** LLP 0231's D3 chooses a third option —
generate-time refusal of the interfering plan — which pays the price in author
friction instead of in silent wrongness. Given LLP 0187's finding that
confident-and-wrong is our agents' characteristic failure mode, that is the
right side of the trade, and Snowflake is the evidence for why the other side is
uncomfortable.

**BigQuery — the only vendor here that ships both shapes and lets you pick.**
[Column-level security](https://docs.cloud.google.com/bigquery/docs/column-level-security-intro)
with policy tags is refusal: "If a user has dataset access but does not have the
Data Catalog Fine-Grained Reader role, the column data is not available to the
user. If such a user runs `SELECT *`, they receive an error which lists the
columns that the user cannot access." The recovery is an explicit
`SELECT * EXCEPT (ssn)`.
[Column data masking](https://docs.cloud.google.com/bigquery/docs/column-data-masking-intro)
is substitution, and is sold precisely on not refusing: "Unlike with
column-level access control, you don't need to modify existing queries by
excluding the columns that the user cannot access."

BigQuery's masking documentation also contains the closest thing in any vendor
material to an interference analysis — though it is framed as usability, not
security. Per masking rule:

- nullification "makes it less useful in query `JOIN` operations ... because a
  `NULL` value isn't sufficiently unique to be useful when joining tables";
- SHA-256 hashing is deterministic and therefore *joinable* — which is to say it
  deliberately preserves an equality channel;
- `RANDOM_HASH` joins are "only possible *within the same query*. Joins across
  different queries aren't possible because of the per-query random salt";
- "Queries that include data masking on the partitioned or clustered columns are
  not supported."

*Design lesson.* That list is a noninterference lattice written by an engineer
who was thinking about joins and stopped there. It is the right axis and the
wrong coverage: `WHERE`, `ORDER BY`, and `GROUP BY` go unmentioned. A class-M
spec should generalize BigQuery's per-rule reasoning to **every** plan position,
and should treat "deterministic hash so joins still work" as an explicitly
declared equality-channel disclosure rather than a free convenience.

*Confidence: high.* All four read from vendor documentation 2026-08-12, quoted
and linked inline.

### 5.4 — masking side channels: the empirical record

This is the load-bearing subsection. The theoretical claim — a masked column
still usable in `WHERE`/`ORDER BY`/`JOIN`/aggregate positions leaks its value by
inference — has a published, dated, versioned record in a shipping database that
implemented *exactly the feature LLP 0231 calls class M*: SurrealDB's
per-field `DEFINE FIELD ... PERMISSIONS FOR select WHERE ...`, a conditional
per-row field disclosure rule. It was bypassed at least six documented ways.

| Advisory | Channel | Affected | Fixed |
| --- | --- | --- | --- |
| [GHSA-9722-9j67-vjcr](https://github.com/surrealdb/surrealdb/security/advisories/GHSA-9722-9j67-vjcr) | six mechanisms at once: `SELECT VALUE`, field aliasing, function arguments, `WHERE`-clause inference, `RETURN BEFORE`, `SET` references | < 2.0.4 | 2.0.4 |
| [GHSA-c8jx-96c9-8xrp](https://github.com/advisories/GHSA-c8jx-96c9-8xrp) | indexed-`COUNT` fast path skips the field check | < 3.1.0 | 3.1.0 |
| [GHSA-6g9v-7gq3-p2c6](https://github.com/advisories/GHSA-6g9v-7gq3-p2c6) | arithmetic and `extend` errors embed the raw operand | < 3.1.0 | 3.1.0 |
| [GHSA-fpxg-5xmv-922m](https://github.com/advisories/GHSA-fpxg-5xmv-922m) | JSON Patch `copy`/`move` with empty `from` relocates the value to an unfiltered name | < 3.1.0 | 3.1.0 |
| [GHSA-h4h3-3rfj-x6fq](https://github.com/advisories/GHSA-h4h3-3rfj-x6fq) | indexed `ORDER BY` returns rows in the hidden values' true sorted order | 3.0.0–3.1.4 | 3.1.5 |
| [GHSA-hv6h-hc26-q48p](https://github.com/advisories/GHSA-hv6h-hc26-q48p) | graph and reverse-reference traversals skip the field check | 3.1.0–3.1.4 | 3.1.5 |

Two of these deserve quoting, because they are the exact hazards LLP 0231 §D3
names.

**The ordering channel.** GHSA-h4h3-3rfj-x6fq: "When that field is indexed, a
record user who cannot read it could still recover the relative ordering of its
values across every record by issuing `ORDER BY <field>`: the field came back
`null` as intended, but the rows were returned in the hidden values' true sorted
order." The root cause is stated with unusual clarity — the planner "selects the
field's index and walks it in value order; the field-level permission is applied
later, when the row is projected, so the value is nulled but the row order
already encodes it." The fix applies "the field-permission guard to the
`ORDER BY` clause as well as the `WHERE` clause," disabling the index
optimization and sorting after redaction. The vendor's own workaround advice is
the harshest verdict available: "Do not rely on field-level SELECT permissions
to hide values on indexed fields from record users; restrict at the table level
instead."

**The aggregate channel.** GHSA-c8jx-96c9-8xrp: the planner "used an
indexed-COUNT shortcut (`Index::Count`, `IndexCountScan`, or the legacy
`Iterate Index Count` / `Iterate Index Keys` paths) that counts matching index
entries and skips the permission check that would normally hide the value," so
`SELECT count() FROM t WHERE hidden_field = "guess" GROUP ALL`, repeated,
recovers the value.

**The pattern across all six is one pattern.** The masking rule was correct
every time. What varied was *which part of the engine touched the raw value
before the projection filter ran*: the index scanner, the counter, the error
formatter, the traversal walker, the patch applier, the expression aliaser.
Field masking is not a property of a rule; it is a property of the **plan**, and
it holds only if every operator that can observe the value is enumerated.
A per-field mask on a system with a query optimizer is a whole-optimizer
obligation.

Three corroborating instances from other systems, so this does not rest on one
vendor:

- **PostgreSQL RLS documents its own covert channels.** Per
  [row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html),
  a policy expression "will be evaluated for each row prior to any conditions or
  functions coming from the user's query. (The only exceptions to this rule are
  `leakproof` functions, which are guaranteed to not leak information; the
  optimizer may choose to apply such functions ahead of the row-security
  check.)" — i.e. the ordering guarantee is explicit *and* has a named
  exception. It also warns that "Referential integrity checks, such as unique or
  primary key constraints and foreign key references, always bypass row security
  ... Care must be taken when developing schemas and row level policies to avoid
  'covert channel' leaks of information through such referential integrity
  checks," and documents a race in which a sub-`SELECT` policy predicate reads a
  stale snapshot. Its fail-closed switch is worth stealing wholesale: setting
  `row_security` to `off` "does not in itself bypass row security; what it does
  is throw an error if any query's results would get filtered by a policy" — a
  mode that converts silent filtering into refusal, for exactly the callers who
  must not be silently filtered.
- **Cardinality leaks through pagination.** GitLab's
  [GraphQL authorization guide](https://docs.gitlab.com/development/graphql_guide/authorization/)
  filters collections after paginating, "so some pages may be smaller than the
  requested page size, due to redacted objects being removed," and warns that
  loading-then-redacting rather than scoping the load "can expose the presence
  of confidential resources."
- **Aggregates escape row scoping too.** Hasura
  [issue #7773](https://github.com/hasura/graphql-engine/issues/7773) reported
  that on the MSSQL backend a role's select-permission filter was applied to row
  queries but not to aggregations, so a user entitled to one row could read a
  count of 275. Closed, high priority; the reporter located it "in the SQL
  translation layer for MSSQL."

*Design lesson, and the one to carry into the sibling spec.* The positions that
must be covered are not a short list of syntax: **projection, predicates,
ordering, join keys, grouping keys, aggregate inputs, index and fast-path
selection, error message text, derived and aliased expressions, write-path reads
(`RETURN BEFORE`, `SET`, patch relocation), and traversal or relationship
edges.** SurrealDB shipped a correct rule and lost on most of these. A spec
that enumerates masked *fields* without enumerating masked *positions* has not
specified anything.

*Confidence: high.* Advisories and vendor documentation read 2026-08-12 and
linked inline. We have not reproduced any of the attacks.

### 5.5 — null-substitution, row suppression, and refusal

The three semantics have different leak profiles, and the choice is not a matter
of taste.

- **Refusal** (column privileges, BigQuery CLS, Hasura's per-role schema) leaks
  the *existence* of a restriction and nothing else. It breaks `SELECT *` and
  forces the author to say what they want. Loud, and cheap to reason about.
- **Null-substitution** (SQL Server DDM, Oracle DR, BigQuery masking,
  SurrealDB, the GraphQL null-field convention) preserves row shape, row
  membership, and row count. It leaks through every non-projection position
  unless each is separately handled — §5.4 is the bill for not doing so.
- **Row suppression** (RLS, GitLab's redaction) removes the row. It closes the
  value channel completely and opens a *cardinality* channel instead: short
  pages, count deltas, missing neighbours.

LLP 0231 has already made this choice, and the record explains why the
alternative was unavailable rather than merely unattractive: pointing-room needs
every voter's row present with only `value` concealed, so row suppression would
change the round's visible participant list and would itself be a disclosure.
That leaves null-substitution — **the shape with the worst empirical record** —
which is what D3's pairing with a generate-time-refused noninterference clause
is answering. Null-substitution for row shape, refusal for interference: on this
record neither half is sufficient alone, and no system in this survey ships the
combination.

*Confidence: high on the taxonomy,* which is assembled from the sources above.
*Medium* that "no system ships the combination" is exhaustive; it is exhaustive
over what we read.

### 5.6 — cell suppression and inference control

The statistical-disclosure-control line is the oldest form of this argument and
supplies its shape. The canonical survey is N. R. Adam and J. C. Wortmann,
*Security-Control Methods for Statistical Databases: A Comparative Study*, ACM
Computing Surveys 21(4):515–556, 1989, which classifies controls into four
families — conceptual, query restriction, data perturbation, and output
perturbation.

The transferable result is the **primary/complementary suppression**
distinction. Suppressing only the sensitive cells of a published table is
insufficient, because marginal totals let a reader recompute them; protecting
them requires suppressing additional, non-sensitive cells — complementary
suppression — chosen so no sensitive value can be closely estimated. Choosing a
minimal such set (the cell suppression problem) is NP-hard, per Kelly, Golden
and Assad (1992); the practical literature is consequently a literature of
heuristics.

Two lessons and one caution:

1. **Hiding exactly the sensitive thing is generically not enough** when the
   surrounding structure is arithmetic over it. This is the classical statement
   of §5.4's aggregate channel, forty years earlier, and it is why a class-M
   mask must reason about what *else* the query exposes, not only about the
   masked cell.
2. **The optimal repair is intractable**, which explains why every production
   system in §5.3 either caps expressiveness, refuses, or accepts the leak and
   says so. A spec that promises to compute a minimal safe masking is promising
   an NP-hard search; refusal is the tractable discipline.
3. **Caution on transfer.** SDC's threat model is a *static published table*
   queried in aggregate by an analyst. Ours is a *live per-viewer query* over
   per-row facts, where the adversary controls the query. The argument's shape
   transfers; the algorithms (rounding, perturbation, k-anonymity thresholds) do
   not, and a class-M spec should not import them.

*Confidence: medium-high on the substance,* which is standard and uncontested.
*Medium on the bibliography:* attribution for Adam & Wortmann and for the
NP-hardness result was confirmed through indexing services rather than the
papers themselves — the ACM Digital Library returned 403 to our fetcher — and
neither paper was read in full this pass. Verify page numbers before citing
them in a published document.

### 5.7 — GraphQL field-level authorization

The GraphQL literature is the weakest body surveyed here, and its weakness is
itself the finding.

Official [GraphQL.js guidance](https://www.graphql-js.org/docs/authorization-strategies/)
is explicit that the schema layer is the wrong place: "In production systems
authorization should be handled in your business logic layer, not your GraphQL
resolvers." It presents field-level control as conditionally returning `null`,
notes that resolver-scattered checks are error-prone, and treats `@auth`-style
directives as annotations the implementer must wire up themselves. (The
`graphql.org/learn/authorization` page returned 403 to our fetcher and was not
read.)

The most useful primary source is a practitioner one: GitLab's
[GraphQL authorization guide](https://docs.gitlab.com/development/graphql_guide/authorization/),
which declares field authorization as `field :secret_name, ..., authorize:
:owner_access` and specifies the semantics — "If the currently authenticated
user fails the authorization, the field resolves to `null`," while collections
are redacted after pagination. Its stated best practice is the interesting part:
"load only what the currently authenticated user is allowed to view with our
existing finders first, without relying on authorization to filter the
records."

*Design lesson.* That sentence is composition-over-post-evaluation — LLP 0231's
D3 — derived independently, from the leak side, by people who had shipped the
post-evaluation version and watched it leak cardinality. But the field half of
the GraphQL discipline never gets past nulling the output: **there is no
noninterference concept anywhere in this literature**, no treatment of a
nulled field still driving a sort or a filter argument, and no generate-time
check. Class M cannot be specified from GraphQL prior art; it can only be
warned by it.

*Confidence: high on what the sources say,* read 2026-08-12. *Medium-high* on
"no noninterference concept," which is a negative claim over the material we
read, not over the whole literature.

### 5.8 — what this tier says about LLP 0231's class-M envelope

Mapping the evidence onto [LLP 0231](./0231-entity-and-permissioning-recommendation.rfc.md)
§D3's three pinned clauses:

- **Noninterference** — supported, and the strongest-supported clause in the
  RFC. Six SurrealDB advisories, Oracle's and Microsoft's own disclaimers, and
  Snowflake's opposite design all say the same thing: projection-time masking
  without a plan-position rule is not a boundary. D3's generate-time refusal is
  the only option in the taxonomy that gets noninterference without Snowflake's
  silent-wrong-answers price. The spec's real work is enumerating positions
  (§5.4), not designing the condition grammar.
- **Fail-closed field addition on every table** — supported by the additive-grant
  hazard in §5.2 and by BigQuery's `SELECT *` refusal. No surveyed system does
  this; the closest is a mechanism (`row_security = off`) that converts silent
  filtering into an error for callers who opt in. Ours would be on by default at
  generate time, which is stronger than anything read here.
- **Obligation-backed re-masking** — **unsupported by prior art, in either
  direction.** Nothing in this tier treats a disclosed→masked transition as an
  event at all. Snowflake, SQL Server, Oracle, and BigQuery re-evaluate the
  policy on the next query and have no notion of an outstanding subscription;
  Hasura's next poll picks it up within the refetch interval; Zero's
  `auth-revalidate-interval-seconds` is off by default. D3's conservative
  delivery route for re-masking is novel relative to everything surveyed, which
  means it carries no borrowed confidence and needs its own acceptance evidence.

And one input to the deferred grammar: the only surveyed mechanism whose
condition can reference *another row* is Hasura's row-permission expression
language (relationships, remote relationships, `_exists`) — and Hasura's column
permissions cannot use it, because they are a flat allow-list. Pointing-room's
`round.revealed || vote.userId == ctx.auth.userId` needs precisely the
cross-table reach of the row language applied at the field locus. **No surveyed
system combines them.** On this record that combination is novel rather than an
assembly of existing parts, and so carries no borrowed confidence from anything
surveyed here.

## The structural mismatch

Stated plainly because it governs what can be adopted:

| System | Decision lifetime |
| --- | --- |
| Zanzibar, SpiceDB, OpenFGA | per request |
| Ent / expo/entity | per load |
| Cedar, OPA | per evaluation |
| Blockaid | per query |
| Postgres RLS | per statement |
| Snowflake, SQL Server DDM, Oracle DR, BigQuery | per column reference, per query |
| InstantDB | per object, re-evaluated on every live invalidation |
| Supabase Realtime (WALRUS) | per WAL change, per subscriber |
| Hasura live queries | per refetch tick (1 s default), whole query re-run |
| Zero | per query transform: on reconnect, on token refresh, and on an optional revalidation timer that is off by default |
| **Snapback** | **for the life of a subscription** |

A durable subscription turns an authorization decision into retained state.
It must be invalidated by three independent event classes — data change, policy
change, and membership change — and LLP 0053 exists because of the second and
third.

The 2026-08-12 reading pass sharpens the mismatch rather than softening it.
Every live-query system now measured in that table answers the lifetime question
the same way: **by not retaining a decision.** Supabase re-derives per change per
subscriber, Hasura re-runs the whole composed query on a timer, and Zero
re-transforms on connection events plus an opt-in interval that ships disabled.
Those are three different amortization strategies for one structural choice, and
none of them is an invalidation edge. Snapback is not choosing a harder point on
a known curve; it is off the curve.

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

For the field-masking sibling spec specifically, read **Tier 5 in the order
5.4 → 5.2 → 5.3 → 5.5**: the side-channel record first, so the mechanisms are
read as attempts against a known attack surface rather than as menu options.

## Open questions

1. **Does LLP 0170's negative result survive Blockaid?** Is the obstacle our
   manifest or the problem?
2. **What reaches a Zero subscription when the *data backing* a permission
   changes** — a membership row, not the ruleset? The 2026-08-12 pass settled
   the ruleset and connection-event halves (re-transform on connection events
   plus `auth-revalidate-interval-seconds`, which ships unset); the
   relational-fact half is what remains, and it is the half our D4 must answer.
3. **Is our commit version usable as a zookie**, or does the correspondence break
   under jurisdictional/multi-object placement (LLP 0014)?
4. **Could one policy model lower to both RLS and matcher predicates**, or does
   the SQLite/Postgres split force two?
5. **Does the data-flow framing (Meta's policy zones) fit our declared reads and
   effect ceilings** better than per-load checks, given we already compute that
   information?
6. **Can a masked column be referenced in a role's `where`/`order_by` in
   Hasura?** The per-role schema statement implies structural exclusion; no page
   we read says so. This is the only surveyed system that might already have
   noninterference at the field locus, and settling it changes whether class M
   has a precedent or is novel (Tier 5.1, 5.7).
7. **Which plan positions must a class-M refusal cover?** Tier 5.4 gives an
   eleven-position list assembled from six SurrealDB advisories and three
   corroborating instances. Is it complete against *our* matcher — indexes,
   fast paths, error text, JS handler `ctx.db` reads, and D4 invalidation
   edges — or does our plan space add positions the SQL literature does not
   have?
8. **Does bounded staleness beat correctness here?** Every live system surveyed
   answers revocation with a timer. LLP 0056's revocation-correctness argument
   says we should not, but no surveyed system pays what we would pay, and the
   cost side of that comparison is unmeasured.

## Confidence

Overall **medium-high on the survey** — raised from medium by the 2026-08-12
primary-source pass, which read the sources behind every section added on
2026-08-11 plus the whole of Tier 5 — and **high on the two findings that are
about our own corpus** (the coverage gap and the LLP 0011 §462 observation, both
mechanically verified).

Confidence is now uneven by tier, deliberately:

- **High, freshly read and linked:** Zero, Hasura, Supabase Realtime, OPA's
  Compile API and fragment, Meta's policy-zones material, the Passant
  attribution, and all of Tier 5's vendor documentation and advisories.
- **Medium, assessed from knowledge of the literature and not re-read this
  pass:** Blockaid, Noria/DBSP, Cedar, SpiceDB and the Zanzibar
  implementations, Firebase, TAO/Ent, and the Tier 4 research line.
- **Explicitly unverified, and labeled in place:** Zero's deprecation
  rationale; OPA's behaviour outside the filtering fragment; Oso entirely;
  Hasura's `where`/`order_by` treatment of unselectable columns; Zanzibar's
  zookie mechanics (the USENIX PDF returned 403 to our fetcher); the
  bibliographic details of the cell-suppression papers (ACM DL returned 403).

No system here has been evaluated against Snapback's manifest in detail, and we
have reproduced none of the attacks or benchmarks cited.

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
overall survey confidence lowered to medium. Those post-round additions were
reviewer-reported and pending a fresh reading pass.

Revised again **2026-08-12** by that primary-source reading pass, which was the
condition LLP 0231 §D3 placed on writing the class-M sibling spec. It did two
things.

**It checked the reviewer-reported entries against their sources.** Confirmed:
Supabase WALRUS (now with the vendor's published per-subscriber cost curve),
OPA's Compile API and its documented closed data-filtering fragment, Hasura's
compilation of permission predicates into the generated SQL, the Meta hedge
(which the sources support and which is now tightened — Meta's stated complaint
is audit cost at scale, not a correctness verdict), the Zanzibar confidence
split, and the Passant citation. Corrected: Zero's removal is 0.25, not 0.15,
its published pages give **no** deprecation rationale, it never shipped
column-level rules, its out-of-band revocation answer is an opt-in timer that
defaults to unset, and the survey was stale by a major version line; Hasura's
live path is **whole-query re-execution on a 1 s refetch timer**, not
incremental invalidation, and its column permissions are a flat allow-list that
cannot express class M's condition, so "the only production system here with a
column-level surface" was wrong; OPA's "refuses unsupported constructs" was
withdrawn as unverified; Passant is scoped to monotonic SQL-92, excluding
negation and recursion.

**It filled the field- and column-enforcement gap** with Tier 5, whose center of
gravity is the masking side-channel record (§5.4) — six published SurrealDB
advisories against conditional per-field SELECT permissions, plus corroborating
instances from PostgreSQL RLS, GitLab GraphQL, and Hasura. The tier's conclusion
is that §D3's noninterference clause is the minimum the record supports, that
its fail-closed field addition is stronger than anything shipped, and that its
obligation-backed re-masking has **no prior art in either direction** and
therefore carries no borrowed confidence.

**The 2026-08-12 additions are unreviewed.** No convergence is claimed for this
document. Every factual claim added in this pass carries an inline link to the
source it was read from; claims that could not be verified are labeled
unverified in place rather than dropped or asserted. Tier 5 is the durable form
of this pass's reading; the working digest it was drafted from is not retained
in the corpus.
