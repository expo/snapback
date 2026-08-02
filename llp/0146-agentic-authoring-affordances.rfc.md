# LLP 0146: Agentic authoring affordances

**Type:** RFC
**Status:** Draft
**Systems:** Agent operating surface, Generated artifacts, Acceptance and
verification, Diagnostics, Schema and storage, Live queries, Developer
experience
**Author:** Charlie Cheever / Claude (Opus 5)
**Date:** 2026-08-01
**Revised:** 2026-08-01 (v0.1, initial draft)
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
**Related:** LLP 0008, LLP 0010, LLP 0017, LLP 0019, LLP 0020, LLP 0024,
LLP 0040, LLP 0042, LLP 0054, LLP 0055, LLP 0061, LLP 0062, LLP 0080,
LLP 0081, LLP 0097, LLP 0108, LLP 0110, LLP 0115, LLP 0127, LLP 0131,
LLP 0134, LLP 0135, LLP 0144

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

One decision moved between v0.1 and v0.2 and is worth stating up front:
because live fan-out on the Cloudflare arm selects subscriptions by
manifest-declared tables, **D1 is a correctness seam on that target**, not
only a trustworthiness improvement to the artifact. That raises D1 from
"first because it is cheap" to "first because a shipped target can lose
live updates without it."

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
| Captured read/write dependencies beside declared ones | Shipped, unchecked | `FunctionRunResult` in `src/local.rs:1447` |

The last two rows are the leverage. `acceptance.run` is a named hole in a
ratified contract. And Snapback already computes *both* the declared and
the observed dependency sets of every handler — and never compares them.

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
named path. The fallback is conservative where the captured facts are
complete — it can only add wake-ups — but where nothing was captured, an
empty or wrong `read_set_summary.tables` decides delivery on its own.
Mutation commit validation is on firmer ground: it validates
`executed.reads`, the runtime-captured set, forwarded from
`src/local.rs:11111`, `:11568`, `:11797` and reaching the validator at
`src/storage.rs:4454-4457`.

### Cloudflare arm — declared tables are the only fan-out filter

Here the critique's original claim is simply correct. `fanOut` selects
affected subscriptions with
`functionTables(fn).some((table) => changedTables.has(table))`
(`cloudflare/src/coordinator.js:5163-5167`), and `functionTables` returns
the function's declared `fn.tables` (`:5539-5542`). Captured reads are
recorded on this arm but deliberately unused: the coordinator's own header
says "captured read sets are recorded but not yet validated"
(`cloudflare/src/coordinator.js:22-23`), with serialisation standing in for
the isolation the manifest declares.

**Therefore: a handler that declares table A and dynamically reads table B
will not be woken when B changes, on Cloudflare, today.** That is a live
correctness defect reachable by exactly the authoring mistake an agent is
most likely to make.

### Other arms

- **Relational, bounded-children, and search queries** never consult
  captured deps for invalidation; they are deliberately table-granular over
  the *plan's* declared sources (`plan.root`/`plan.joined`,
  `plan.parent_table`/`plan.child_table`, `plan.table` —
  `src/live_matcher.rs:170-182`). Because those tables come from the
  generated plan rather than a hand-written declaration, an agent cannot
  under-declare them; LLP 0080 §4 records the table-granularity as
  intentional.
- **Offline/RQS retention** is out of scope for this correction and gets no
  claim here; its disposition is OQ12.

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

```
missing:    captured \ declared          (authoritative when provenance = complete)
extra:      declared \ captured-here     (data, not a verdict)
provenance: complete | incomplete | unsupported
```

`incomplete` and `unsupported` are not decoration. Action results carry
empty captured sets by construction (`src/local.rs:1705-1740`), failure
paths may lack a complete dependency witness, and the local matcher itself
distinguishes "captured reads summarise the handler" from "they do not"
(`src/live_matcher.rs:229-233`). A conformance surface that reports
`conformant` from an empty capture would manufacture exactly the false
confidence it exists to remove.

Three surfaces, in increasing strictness:

1. **Report (v0).** Every invocation that carries an authoritative capture
   emits `missing`, `extra`, and `provenance`. Attach to `FunctionRunResult`
   and to the `app.inspect` recent-invocation ring. Note the ring today
   records *host operations* only (`src/host_ops.rs:63-64`), so the
   app-data plane must be wired into it — or the surface scoped to host-op
   invocations and said so.
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

**Cloudflare disposition.** Report and coverage do not by themselves fix
the fan-out defect. That arm needs either captured-read consumption in
`fanOut` or a conservative widening — treat an under-declared or
unwitnessed function as affected by every changed table — chosen in OQ8.
Strict mode is the third option and the only one that keeps fan-out cheap.

*Acceptance:* a handler reading an undeclared table reports non-empty
`missing` with `provenance: complete`, fails `verify` coverage, and is
refused with the named code under strict mode; an action reports
`provenance: unsupported` rather than `conformant`; a conditionally-read
declared table produces no over-declaration warning until aggregate
coverage shows no path witnesses it; and the coverage report names which
of the success, failure, action, relational, search, snapshot-bundle, and
per-target paths yielded authoritative evidence.

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
snapback-app introspect --changed-since <envelopeHash> --budget-bytes 32768
```

**Hash custody is a required decision, not an implementation detail.** A
prior hash alone cannot produce a delta unless something can recover what
that hash denoted. Three shapes are possible — the server retains recent
digest manifests; the client presents its prior digest for server-side
diffing; or the hash resolves only to an artifact generation and the delta
is computed against that. Each has a different retention, authority, and
unknown-hash story, and an unknown hash must degrade to a full digest with
a named reason rather than an error or, worse, an empty delta that reads as
"nothing changed." OQ10 carries this.

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
single-field schema change produces a minimal diff; a budget too small to
hold the schema still produces a valid digest with a truthful elision
marker.

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
that. D4 therefore reports the *declared* radius from artifacts alone, and
reports an *observed* radius only when an observation bundle (a D2 receipt
or a D6 scenario run over the new generation) is supplied. Where only the
declared radius is available, the diff says so rather than implying
completeness.

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
  targetIndex: 'by_room_user',
  onTargetDelete: 'restrict',
}))
```

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
not to promoted bounded-relation incarnations**, which keep `hide-orphans.v1`;
codegen must refuse an `existsRelation` whose target is a promoted
incarnation. Whether the two should ever converge is OQ13.

Codegen must **prove boundedness**: an invariant that cannot name a
supporting index is a generation error, not a slow commit. It must also
define transaction-final-state semantics (the invariant is evaluated once
against the buffered final state, not per statement) and its behaviour
against pre-existing rows at migration time.

*Acceptance:* both directions refuse with the invariant's name in the
refusal; an invariant without a supporting index fails codegen; an
`existsRelation` targeting a promoted relation incarnation fails codegen
with a named reason; a mutation that transiently violates and then repairs
the invariant within one transaction commits; commit cost stays
index-bounded under a growing target table.

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

**Replay is guaranteed only over controlled seams**, and v0.1's acceptance
criterion overreached by requiring every shrunk violation to reproduce.
Recording an ordering the runner does not control does not make that
ordering enforceable on replay. A shrunk scenario therefore carries a
**reproduction class**: `deterministic` (every step is a controlled seam —
replay must reproduce), or `observed` (the violation depended on an
uncontrolled ordering — replay attempts it and reports a reproduction rate,
never a guarantee). An `observed` counterexample is still far more useful
than a raw log, but it must not be presented as a regression test.

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
      "authorityEffect": "widens" },
    { "kind": "useDifferentPrincipal",
      "riskClass": "authority-sensitive",
      "machineApplicable": false,
      "requiresApproval": true,
      "authorityEffect": "changes-effective-principal" },
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

The carrier is not settled here: LLP 0144 owns the refusal wire envelope and
requires caller-visible disclosure, so whether `remediations[]` rides that
envelope, a sibling field, or a separate lookup — and how it projects to
CLI, HTTP, and MCP — is OQ6, now widened to cover the carrier as well as the
registry.

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

**One item jumps the waves.** The Cloudflare fan-out disposition (OQ8) is
not a Wave 3 concern: it is a live-delivery defect on a shipped arm, and
whichever of the three shapes is chosen — captured-read consumption,
conservative widening, or required strict mode — it should land with Wave 1
rather than wait for strict mode's authoring-contract decision.

**Deferred lane.** C9 after D7; C10 after D1; C11 when LLP 0097 becomes
implementable.

The rationale for the ordering is that exposing whether the agent's model
matches reality (Wave 1) raises success rates sooner, and with less
permanent surface area, than adding correctness primitives (Wave 3) whose
value an agent cannot exploit while its model of the app is still wrong.

## Open questions

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
   registry keyed by refusal code, and does `remediations[]` ride LLP 0144's
   refusal envelope, a sibling field, or a separate lookup? What is the
   disclosure behaviour across the CLI, HTTP, and MCP projections?
7. **CV-14 custody.** D4 claims LLP 0115 CV-14, which rides a custody
   trigger in the 0062 family. Does claiming it here satisfy the trigger, or
   must the custody owner ratify?
8. **Cloudflare fan-out disposition.** Three shapes close the declared-table
   fan-out defect: consume captured reads in `fanOut`; widen conservatively
   (an under-declared or unwitnessed function is affected by every changed
   table); or require strict mode on that target. The first costs a storage
   read per fan-out, the second costs delivery precision, the third costs an
   authoring-contract change. Which, and does it gate any hosted claim?
9. **`acceptance.run` relationship.** D2 is a CLI composition and explicitly
   does not implement the pinned operation. Does `verify` later become the
   shared core that `acceptance.run` projects, carrying the LLP 0024 result
   contract, or do the two stay separate surfaces?
10. **Digest hash custody.** Who retains what a prior digest hash denoted —
    server-side digest manifests, client-presented prior digest, or
    generation-only resolution? What retention, expiry, and authority
    boundary applies, and is degrading an unknown hash to a full digest with
    a named reason the right behaviour?
11. **Generalising `membership.lastHolder`.** D5 withdraws
    protected-last-member because memberships already enforce it. Should a
    generic protected-cardinality invariant exist, and if so does it reuse
    or supersede the shipped rule?
12. **Offline/RQS arm disposition.** The correction is scoped to the local
    and Cloudflare arms. What does retention/replay on the JS arm consume —
    captured dependencies, declarations, or neither — and does under-
    declaration have an observable effect there?
13. **D5 versus the bounded-relation family.** D5 applies only to ad-hoc
    relations and must refuse promoted incarnations. Should the two
    eventually converge on one relation vocabulary, and who owns that?
14. **Conformance evidence on non-local targets.** D1's provenance states
    are defined against local capture. What constitutes an authoritative
    capture on Cloudflare, where captured reads are recorded but unused?

## Status

Draft. No implementation is authorized by this document. D1, D2, and D3 are
the intended first tranche and are the smallest of the seven; D5 and D6 are
substantial subsystems and should be re-scoped after Wave 1 lands, when the
conformance and verification surfaces will have made some of their
motivating failure classes observable rather than hypothesized.

Round-1 dual-family review returned NOT READY from both families; v0.2
applies every finding, and the fourteen open questions above are the honest
residue. The Cloudflare fan-out defect (OQ8) is the one item in this
document that describes a live product defect rather than a missing
affordance, and it should be ticketed independently of whether the rest of
this RFC is accepted.
