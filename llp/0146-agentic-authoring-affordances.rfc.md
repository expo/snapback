# LLP 0146: Agentic authoring affordances

**Type:** RFC
**Status:** Draft
**Systems:** Agent operating surface, Generated artifacts, Acceptance and
verification, Diagnostics, Schema and storage, Live queries, Developer
experience
**Author:** Charlie Cheever / Claude (Opus 5)
**Date:** 2026-08-01
**Revised:** 2026-08-01 (v0.1, initial draft)
**Related:** LLP 0010, LLP 0017, LLP 0019, LLP 0024, LLP 0042, LLP 0054,
LLP 0055, LLP 0061, LLP 0062, LLP 0097, LLP 0108, LLP 0115, LLP 0127,
LLP 0131, LLP 0144

## Summary

Snapback's agentic-authoring investment so far has produced an operating
surface (LLP 0024), its three projections — CLI, HTTP, MCP (LLP 0042) —
an agent-first guide with a witness-bearing capability index (LLP 0061),
agent principals with scoped grants (LLP 0055), and a generated per-app
CLI (LLP 0062). Mutation dry-run, query explain, and checkpoint are
implemented in `src/host_ops.rs`. LLP 0019's recommended sequence is
substantially executed.

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
with type-aware suggestion. Five candidates are explicitly declined or
deferred, including two that are attractive and wrong.

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
| Query explain | Shipped | `explain` in `src/host_ops.rs`, `src/local.rs` |
| Checkpoint | Shipped | `checkpoint` in `src/local.rs`, `src/auth/backup.rs` |
| Agent principals and scoped grants | Shipped | route `/auth/agents/pair`; LLP 0055 |
| Agent-first guide with witness-bearing capability index | Shipped | `guide/capabilities.md`; LLP 0061 |
| Generated per-app CLI | Partial | `snapback-app` in `packages/snapback-app-cli/cli.mjs`; LLP 0062 |
| Stable diagnostic codes | Shipped | `SNAPBACK_*`; LLP 0010 "Bootstrap diagnostic codes" |
| Declared app refusal codes | Draft | LLP 0144 |
| Bounded recent-invocation ring in `app.inspect` | Specified | LLP 0042 §"Diagnostics reading" |
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

## A verified correction

The critique's strongest claim was that declared `reads`/`writes` drift
makes **live invalidation silently wrong**: an agent adds a
`ctx.db.query('members')` call, forgets the declaration, and the handler
returns correct data on direct invocation while subscriptions fail to
re-fire.

**This premise is false as stated, and the correction changes D1's shape.**

Live subscriptions register `CapturedReadDependency` values, not
manifest-declared table names. `subscribe_live_*` and the invalidation
path key off `query.read_dependencies` (`src/local.rs:13399`, `:13688`,
`:14618`), which is the set captured during evaluation. Mutation commit
likewise validates read sets against `executed.reads` — the runtime-captured
set (`src/local.rs:11111`, `:11568`, `:11797`). The runtime is not reasoning
from the declarations.

What is actually true is narrower and still worth fixing:

- Both sets exist and are carried side by side on `FunctionRunResult`
  (`src/local.rs:1447-1458`), with a doc comment naming the mismatch as the
  Valet "counts stuck at zero" failure class.
- **Nothing compares them.** The only consumer of `captured_reads` outside
  `local.rs` is `function_run_secret_scopes` in `src/admin.rs:1774`, which
  merely unions both sets to widen secret-read lease scopes.
- Declarations are documented as "evidence, not enforced ceilings"
  (LLP 0127 decision 6; `packages/snapback-codegen/inline-helper-sharing.test.mjs:7`).

So the defect class is not a broken runtime. It is that **the manifest —
the artifact every agent, review surface, and generated integration reasons
from — can silently diverge from behavior**, and Snapback holds both halves
of the proof and never joins them. An agent reading the manifest to answer
"what does this function touch?" gets an answer no one has checked.

That makes D1 cheaper than proposed (a join over facts already recorded,
not a fix to invalidation) and relocates its primary value from runtime
correctness to *artifact trustworthiness*.

## Decisions

### D1. Declaration/observation conformance

**Build first.** Join the two dependency sets Snapback already computes and
make divergence a named, addressable fact.

Three surfaces, in increasing strictness:

1. **Report (v0).** Every function invocation that carries both sets emits a
   conformance verdict: `conformant`, `underDeclared` (captured ⊄ declared),
   or `overDeclared` (declared entries never witnessed). Attach it to the
   `FunctionRunResult` and to the `app.inspect` recent-invocation ring so an
   agent can read it without instrumenting anything.
2. **Coverage (v0, inside D2).** `verify` reports declared dependencies never
   witnessed by any acceptance path, and functions whose captured set exceeded
   their declaration during the run. Over-declaration is a warning; under-
   declaration is a failure.
3. **Strict mode (v1, opt-in per app).** Application-table reads and writes
   must be a subset of the declarations, refused at the seam with
   `SNAPBACK_HANDLER_UNDECLARED_READ` / `SNAPBACK_HANDLER_UNDECLARED_WRITE`,
   naming function, table, and the declaration's source span.

Strict mode is opt-in and per-app, not global and not default, because
LLP 0127 decision 6 deliberately admits context-reader helpers whose
declarations are evidence. Flipping that to an enforced ceiling is an
authoring-contract change that must be chosen, not inherited. The escape
hatch is per-dependency-class (explicitly conservative or unobservable
classes), never a blanket disable.

*Acceptance:* a handler that reads an undeclared table is `underDeclared` in
report mode, fails `verify` coverage, and is refused with the named code in
strict mode; a handler declaring a table it never reads is `overDeclared`
and produces a warning, not a failure.

*Cost:* small. Both sets are in hand; the work is the comparison, the
verdict plumbing, two refusal codes (LLP 0144's registry), and the source-
span mapping.

### D2. `snapback verify` — the done-oracle

**Build second.** Agents optimize toward whatever oracle they are handed, so
handing them a good one is the cheapest available leverage. `acceptance.run`
is already pinned in the host-op contract and unbuilt
(`guide/operating/host-ops.md:72`); this closes an acknowledged hole rather
than introducing a concept.

`snapback verify --json` orchestrates, in precedence order:

1. artifact freshness and identity (codegen regenerated from source; input
   hashes match; generation admitted)
2. runtime readiness (the LLP 0010 receipt, digest-bound to the binary)
3. schema/function admission and D1 conformance coverage
4. declared capability requirements resolved against the served target
5. registered acceptance profiles executed

Output is a **receipt** — hash-bound to the artifact generation, replayable
as evidence — plus the existing host-op `next[]` list. A `recommendedNext`
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
introspection, emitted under a declared budget:

```
snapback describe --budget-bytes 32768 [--changed-since <digestHash>]
```

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

Given two artifact generations, emit a stable semantic diff:

- tables, fields, indexes added, removed, or narrowed
- migration required versus additive reload
- functions added or removed
- argument or result contract changes (LLP 0131, LLP 0108)
- auth requirement or authority-creating status changes
- declared read/write set changes
- live invalidation blast radius changes
- capability requirements added or degraded
- generated client surfaces made stale

For an agent, "what did my edit *mean*?" is at least as important as "what
exists now?" — and it is the question the agent is worst at answering for
itself, because the mechanical diff is enormous and the semantic diff is
three lines. Feeds both D2's receipt and D3's digest.

*Acceptance:* a field addition and a field narrowing produce distinct
migration verdicts; an auth-requirement change is never reported as
additive.

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

The v1 vocabulary: required referenced row (`existsRelation`), membership
existence, protected-last-member, and conditional uniqueness. These are the
classes not already covered by uniqueness constraints, transaction read
sets, and the membership-transition invariants Snapback enforces today
(`guide/backend/mutations.md`).

`onTargetDelete` is the part that is easy to miss and does most of the work:
checking message insertion is insufficient — *removing a membership* must
also refuse while dependent messages exist. Both directions, or the
invariant is decorative.

Codegen must **prove boundedness**: an invariant that cannot name a
supporting index is a generation error, not a slow commit.

*Acceptance:* both directions refuse with the invariant's name in the
refusal; an invariant without a supporting index fails codegen; commit cost
stays index-bounded under a growing target table.

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

*Acceptance:* a seeded property violation shrinks to a minimal scenario that
reproduces on replay; the runner refuses to describe as deterministic any
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

```json
{
  "remediations": [
    { "kind": "requestGrant", "requiresApproval": true, "authorityChanging": true },
    { "kind": "useDifferentPrincipal", "requiresApproval": false },
    { "kind": "openGuide", "resourceId": "auth.scoped-roles" }
  ]
}
```

Machine-applicable *only* for typo fixes, exact identifier replacement, and
regeneration — each carrying an artifact-hash precondition so a stale
artifact cannot silently apply a repair. Never machine-applicable for
authority widening, destructive schema change, or policy choices.

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
4. **D5 vocabulary closure.** Four invariant classes are proposed for v1.
   Is that the right cut, and what is the extension procedure — a new
   declared class per RFC, or a bounded combinator algebra?
5. **D6 property set ownership.** The six cross-cutting properties overlap
   LLP 0054's safety and liveness phases. Does D6 claim them, or does
   LLP 0054 own the property catalogue with D6 owning generation and
   shrinking?
6. **D7 remediation registry.** Do remediation kinds live in LLP 0144's
   refusal-code registry, or in a sibling registry keyed by refusal code?
7. **CV-14 custody.** D4 claims LLP 0115 CV-14, which rides a custody
   trigger in the 0062 family. Does claiming it here satisfy the trigger, or
   must the custody owner ratify?

## Status

Draft. No implementation is authorized by this document. D1, D2, and D3 are
the intended first tranche and are the smallest of the seven; D5 and D6 are
substantial subsystems and should be re-scoped after Wave 1 lands, when the
conformance and verification surfaces will have made some of their
motivating failure classes observable rather than hypothesized.
