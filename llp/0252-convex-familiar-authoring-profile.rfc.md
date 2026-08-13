# LLP 0252: Convex-familiar authoring profile

**Type:** RFC
**Status:** Review
**Systems:** Product, Developer experience, Authoring, Application data API,
TypeScript, Code generation, React, Client integration, Competitive evaluation,
Packaging, Documentation, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-12 (initial draft: proposes one experimental
Convex-familiar TypeScript source profile beside the existing explicit profile,
both lowering into one canonical Snapback artifact/runtime path, with a bounded
comparison period and an explicit promotion/merge/withdraw decision)
**Related:** LLP 0000, LLP 0004, LLP 0037, LLP 0061, LLP 0074, LLP 0108,
LLP 0115, LLP 0117, LLP 0119, LLP 0127, LLP 0130, LLP 0146, LLP 0186,
LLP 0189, LLP 0194, LLP 0197, LLP 0198, LLP 0199, LLP 0203, LLP 0218,
LLP 0225, LLP 0236,
LLP 0237, LLP 0238, LLP 0241, LLP 0245, LLP 0246, LLP 0247, LLP 0249,
https://docs.convex.dev/ai/overview,
https://docs.convex.dev/functions/validation,
https://docs.convex.dev/database/reading-data/,
https://docs.convex.dev/api/modules/react

## Summary

Snapback should test a second, deliberately **Convex-familiar TypeScript
authoring profile** without restarting or forking the product. The experimental
profile should use the grammar coding agents already know—`defineSchema`,
`defineTable`, `v`, `query`, `mutation`, `action`, `args`, `returns`, `handler`,
`ctx.db`, generated `api` references, `withIndex`, `useQuery`, `useMutation`,
and `useAction`—while retaining Snapback's stronger requirements where they are
semantically material: explicit authority, frozen ingress and egress contracts,
declared or reviewed data/effect reach, bounded execution, truthful liveness,
truthful offline settlement, target capability honesty, and evidence-bound
generation identity.

The existing authoring profile and the experimental profile would coexist for a
bounded evaluation period. This is **parallel source-profile support**, not two
servers, two manifests, two client transports, or two implementations of each
feature. Each application selects exactly one authoring profile in v1. Both
profile adapters must lower into the same canonical Snapback definition and
artifact pipeline before runtime admission. The current explicit profile remains
the default until comparative evidence and a separate author decision promote,
merge, or withdraw the experiment.

The intended internal product hypothesis is reasonably summarized as
"hardened Convex": the learned TypeScript shape and short ordinary path, with
Snapback's explicit authority, offline, ephemeral, portability, and proof
semantics underneath. That is a design shorthand, not proposed public
positioning and not a compatibility claim. Snapback must call the profile
**Convex-familiar**, never "Convex-compatible," until a separately specified
compatibility corpus establishes exact source and behavioral compatibility.

This RFC also answers the parallel-support concern: supporting both is useful
only if it isolates the effect of the authoring surface and remains cheap enough
to remove. It becomes defeating if source profiles acquire separate semantic
models, runtime branches, guide universes, or indefinite compatibility promises.
The gates below are designed to catch that transition early.

## Motivation

### The evidence points at the doorway, not the foundation

The accepted core-modularization decision rules out a rewrite and records why:
the accumulated value is the Rust/SQLite/runtime stack, the server-authoritative
model, the language-neutral contracts, and the conformance/proof corpus; the
structural problem is ownership and dependency direction, not the foundational
architecture (LLP 0225#decision; LLP 0199#decision).

The authoring evidence points somewhere different. The seven-app rerun still
favored Convex roughly 55/45 on the measured workloads. The later cross-model
synthesis describes Convex as the smoother conventional TypeScript default and
Snapback as stronger where explicit authority, proof, ephemeral state, offline
writes, and day-two evolution matter (LLP 0236#summary;
LLP 0236#convex-remains-the-smoother-conventional-typescript-default). The five
instrumented messaging runs reduced Snapback's defect-shaped framework loops to
zero, yet the measured agent still spent roughly twice the time and tokens in
the final recorded comparison because Convex required no orientation and
Snapback still did (LLP 0198#summary; LLP 0198#the-remaining-gap-decomposed).

That combination is evidence for a front-door experiment, not a core restart:

- agents consistently praise Snapback's codegen refusals, diagnostics,
  server-derived authority, ephemeral state, offline mutation machinery, exact
  contracts, and verification;
- agents consistently stumble on a novel handler dialect, separate ordinary
  and live query kinds, explicit plan/result vocabulary, unfamiliar client
  lifecycle names, and the number of operational concepts exposed before the
  first screen works; and
- the day-two comparison can reverse the day-one ranking because the declared
  artifact graph and migration discipline begin paying back their initial cost
  (LLP 0236#snapback-appears-strongest-on-day-two).

### Convex's learned advantage is now an actively maintained product

The prior-familiarity gap is not merely a static training-data accident. As
verified against Convex's official documentation on 2026-08-12, Convex now
ships coding-agent plugins, managed AI files, agent skills, an MCP server,
agent-mode deployment guidance, and a public eval program. Its ordinary
authoring surface remains a small inferred TypeScript vocabulary spanning
schema, validators, functions, database access, generated references, and React
hooks. Snapback therefore should not assume that guide quality alone will erase
the gap while keeping a substantially novel first-hour grammar.

LLP 0203's principle that vocabulary is API surface applies directly: an agent
that already knows `query`, `mutation`, `ctx.db`, `withIndex`, and `useQuery`
has useful priors before it retrieves any Snapback-specific context
(LLP 0203#p6-vocabulary-is-api-surface). The hypothesis here is that reusing
that grammar can remove orientation actions while Snapback-specific additions
teach only the facts that genuinely differ.

### Existing work makes the experiment cheaper than a restart

The profile can be an adapter over work already decided:

- LLP 0237 admits bounded helper modules without ambient Node power;
- LLP 0246 admits `.ts` and `.mts` sources under a pinned, syntax-erasing
  compiler profile;
- LLP 0245 lets inference propose declarations while accepted source remains
  authority;
- LLP 0241 separates semantic, executable, evidence, bundle, and generation
  identity and gives development custodians one reload model;
- LLP 0238 defines nominal operation kinds and truthful client lifecycle
  semantics; and
- LLP 0247 makes ordinary TypeScript object construction less surprising
  without weakening the canonical value grammar.

The missing decision is not whether Snapback can type a handler. It is whether
the recommended application vocabulary should remain Snapback-specific or gain
a familiar projection over the same contracts—and whether running both
projections briefly provides enough information to choose honestly.

## Goals

1. Let a cold coding agent author an ordinary Snapback application using a
   compact, conventional TypeScript grammar before reading package source.
2. Preserve Snapback's authority, validation, settlement, portability,
   capability, and proof boundaries exactly.
3. Compile both authoring profiles through one canonical definition, artifact,
   runtime, wire, and client-transport implementation.
4. Compare the profiles on the same Snapback version and the same acceptance
   bar, isolating authoring-surface effects from backend differences.
5. Provide a reviewable, state-preserving migration path if the familiar
   profile becomes the default.
6. Bound the coexistence period and measure its maintenance cost so two surfaces
   do not become an accidental permanent commitment.

## Non-goals

- Rewriting the Rust core, storage engine, runtime, live-query engine, sync
  engine, wire protocol, or deployment system.
- Running a second server or keeping a second semantic manifest.
- Claiming source, package, operational, or behavioral compatibility with
  Convex.
- Importing from `convex/*`, accepting an unmodified Convex application, or
  shadowing Convex package names.
- Copying Convex defaults where they would weaken Snapback's security or truth
  model—especially public-by-omission functions, erased result contracts,
  ambient reactivity claims, or queued writes presented as committed results.
- Hiding Snapback's differentiators. Ephemeral state, retained/offline state,
  explicit settlement, typed assets, authority profiles, and verification
  remain first-class extensions.
- Solving the hosted-operations deficit. LLP 0198 correctly identifies
  productized deployment and operations as a separate structural term; familiar
  syntax cannot substitute for it.
- Maintaining two public surfaces forever merely because both once shipped.

## Terminology

- **Explicit profile (`snapback-explicit-v1`)** — the current authoring
  vocabulary, including `defineQuery`, `defineLiveQuery`, declarative plans,
  `results.*`, and the kind-explicit client lifecycle surface.
- **Familiar profile (`snapback-familiar-ts-v1`)** — the experimental
  TypeScript vocabulary proposed here.
- **Profile adapter** — codegen input logic that validates one source grammar
  and emits the canonical Snapback definition. It owns no runtime behavior.
- **Canonical definition** — the language-neutral application/schema/function/
  policy representation consumed by existing artifact generation and runtime
  admission. This RFC proposes a versioned serialized projection named
  `NormalizedApplicationDefinitionV1` so adapters can be compared mechanically;
  it does not create a second manifest authority.
- **Normalized contract identity (`normalizedContractId`)** — a
  domain-separated hash of the canonical schema, operation contracts, authority,
  read/write/effect reach, plans, and capability requirements after adapter
  lowering. It is an equivalence and migration witness only. It never replaces
  LLP 0241's `semanticId`, `executableId`, or `generationId`, and it grants no
  runtime compatibility by itself.
- **Familiar alias** — a conventional name whose narrower Snapback semantics
  are completely specified here, such as online-only `useMutation`. An alias is
  not permission to hide a distinct lifecycle.

## Design

### D1. Two source profiles, one semantic and runtime pipeline

Codegen gains two front-end adapters:

```text
snapback-explicit-v1 source ─┐
                             ├─> NormalizedApplicationDefinitionV1
snapback-familiar-ts-v1 ─────┘        │
                                      v
                         existing schemas/manifests/artifacts
                                      │
                                      v
                         existing runtime/wire/client core
```

After normalization, no subsystem may branch on the authoring profile to decide
authorization, validation, execution, storage, invalidation, settlement,
retention, or transport behavior. The profile remains available only where
source custody and diagnostics need it: generation evidence, source maps,
profile-specific remediation, migration tooling, and comparative records.

The shared boundary is generated or parity-gated under LLP 0037 and
LLP 0203#p1-generated-or-gated-never-transcribed. Every canonical field has one
of four adapter dispositions:

1. **direct** — the source profile spells the fact and the adapter maps it;
2. **profile default** — a versioned, inspectable default supplies the fact;
3. **reviewed suggestion** — LLP 0245 proposes ordinary source and generation
   waits for explicit application; or
4. **unsupported** — generation refuses with a stable code and a route to the
   explicit profile or an owning RFC.

There is no silent `unknown`, omission, best-effort mapping, or runtime
observation arm.

An application selects one profile in its Snapback configuration and generated
manifest. V1 forbids mixing profiles within one application generation. This is
intentionally stricter than per-file or per-operation selection:

- benchmark attribution stays meaningful;
- one operation cannot be declared twice through different grammars;
- imports, defaults, diagnostics, and migration ownership stay unambiguous; and
- profile-exclusive behavior cannot leak into a supposedly equivalent sibling
  operation.

Parallel support means the toolchain can build either kind of application, not
that one application carries both. A later mixed-profile design requires a new
RFC after the evaluation; it is not a convenience extension to this one.

Because LLP 0246 binds source-profile version into semantic identity, two
source profiles retain distinct `semanticId` and `generationId` values even
when their normalized definitions match. `normalizedContractId` provides the
separate equivalence witness. It cannot authorize replay, live resume, retained
settlement, or automatic activation across generations.

### D2. The familiar server vocabulary

The familiar profile uses one cohesive package projection plus generated local
modules:

```ts
// snapback/schema.ts
import { defineSchema, defineTable } from "@expo/snapback/server";
import { v } from "@expo/snapback/values";

export default defineSchema({
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
    ownerId: v.principal(),
  }).index("by_owner", ["ownerId"]),
});
```

```ts
// snapback/todos.ts
import { query, mutation } from "./_generated/server";
import { v } from "@expo/snapback/values";

export const list = query({
  args: {},
  returns: v.array(v.doc("todos")),
  auth: "required-user",
  reads: ["todos"],
  handler: async (ctx) =>
    ctx.db
      .query("todos")
      .withIndex("by_owner", (q) => q.eq("ownerId", ctx.auth.userId))
      .collect(),
});

export const create = mutation({
  args: { title: v.string() },
  returns: v.id("todos"),
  auth: "required-user",
  reads: [],
  writes: ["todos"],
  handler: async (ctx, { title }) =>
    ctx.db.insert("todos", {
      title,
      completed: false,
      ownerId: ctx.auth.userId,
    }),
});
```

The exact `reads`/`writes` refinement syntax remains owned by LLP 0108,
LLP 0146, and the authority/query owners; the strings above illustrate the
compact table-granular first spelling, not a new permission model. Where row,
index, membership, asset, secret, or effect scope matters, the familiar profile
uses the same typed declaration vocabulary and generated authority facts as the
explicit profile. A compact spelling may reference those facts; it may not
weaken them.

The v1 function object has these canonical keys:

- `args` — required frozen ingress validators;
- `returns` — required frozen egress validator, including schema references;
- `auth` — required, with no public-by-omission default;
- `reads` and `writes` — required canonical reach declarations, though
  LLP 0245 may propose addition-only patches;
- `effects`, `secrets`, `capabilities`, and `runtime` — required when used and
  never inferred;
- `delivery` — optional query spelling defined below; and
- `handler` — a bounded `.ts`/`.mts` handler graph under LLP 0237/0246.

The adapter may accept a missing candidate field only long enough to produce a
read-only LLP 0245 suggestion. It may not activate or replace an application
generation until the accepted ordinary source contains every required frozen
fact. Inference proposes; explicit source remains authority.

The familiar profile deliberately follows modern Convex guidance more closely
than Convex's most permissive runtime: both `args` and `returns` are mandatory,
and TypeScript inference checks the handler against them rather than replacing
them. `v.doc(table)` and the shared validator grammar compress declarations
without giving TypeScript runtime authority (LLP 0117#option-space;
LLP 0127#move-1-contracts-reference-nothing-respells).

The generated API projects module names in the familiar shape:

```ts
api.todos.list
api.todos.create
```

Those paths are generated aliases over stable nominal operation references,
not string function names or new operation identities. Renaming or moving a
module follows LLP 0241's semantic-diff and reload rules; the projection cannot
silently retarget an in-flight or retained operation.

### D3. One authored query kind, honest delivery facts

The familiar profile uses `query`, not separate `query` and `liveQuery`
constructors. That authoring convenience does not make every query universally
live.

The profile default is `delivery: "live"`, frozen as part of
`snapback-familiar-ts-v1`. It means:

- the operation is callable one-shot;
- the application requires it to be subscribable on every target on which the
  operation is admitted; and
- generation or target activation refuses if the normalized query/read shape
  lacks the required liveness evidence.

An author may write `delivery: "read"` to declare a one-shot-only query. There
is no `auto`, `best-effort`, or runtime-captured classification in v1. Static
analysis may explain why `live` cannot be proved and propose the explicit
`read` patch, but only accepted source changes the requirement.

This is the option-1b family identified in LLP 0119, narrowed for an
experimental source profile: one familiar authored function kind, live by
default, and an authored escape hatch. It preserves LLP 0074's rule that polling
or refresh convenience is never reported as proven push. It also preserves the
ephemeral lane: durable query liveness and connection-owned ephemeral state
remain orthogonal.

Accepting this RFC would authorize the experiment, not silently settle
LLP 0130 ER-3 for the existing profile. Promotion of one authored query kind to
the repository-wide default remains an author decision after the measured
React rerun.

### D4. Familiar React aliases are deliberately narrower than Snapback's full lifecycle surface

The familiar package may expose:

```ts
import {
  SnapbackProvider,
  useQuery,
  useMutation,
  useAction,
} from "@expo/snapback/react";
import { api } from "../snapback/_generated/api";

const todos = useQuery(api.todos.list, {});
const create = useMutation(api.todos.create);
```

The names are familiar; their limits are explicit and type-enforced:

#### `useQuery`

`useQuery` accepts only a nominal live-capable query reference and provides the
online authoritative convenience projection:

```ts
Result | undefined
```

`undefined` means initial loading, authority transition, unavailable current
data, or loss of current authority. The hook never returns retained,
optimistic, or otherwise stale data through this direct-result shape. It throws
or routes typed refusals through the documented React error boundary; it does
not turn them into `undefined` silently.

Applications that use retention, offline reads, freshness display, explicit
refresh, or diagnostic rendering use the canonical LLP 0238
`useSnapbackLiveQuery` state object. A companion `useQueryState` alias may point
to that same canonical hook, but it must return the complete
`{data,status,freshness,diagnostic,refresh}` grammar rather than a subtly
different cache.

#### `useMutation`

`useMutation` is an online-settled convenience. Its callable dispatches with
`queue: "never"`, resolves only with the validated authoritative result, and
refuses offline before accepting custody. It never maps a queued intent to a
successful result.

Applications that want offline mutation custody use the canonical
`useSnapbackMutationDispatch` plus `useSnapbackMutationStatus` lifecycle from
LLP 0238/0218. Generated JSDoc and a kind/policy mismatch diagnostic route the
author there when a mutation is declared queue-capable or the application asks
for offline behavior.

#### `useAction`

`useAction` is a direct alias over one-shot `run(ActionRef)`. External effects
remain non-rollbackable and retain the existing typed refusal/result contract.
Longer command workflows keep `useSnapbackTask`.

#### Provider and generated references

`SnapbackProvider` is a name projection over the existing provider and
generation/auth/connection owners. The familiar profile creates no second
cache, transport, auth coordinator, outbox, or external-store registry.
Generated refs remain nominal and carry operation kind, authority, retention,
delivery, queue, and guide facts.

These aliases deliberately amend none of LLP 0238's truthful underlying
lifecycles. They do reopen its conclusion that an ambiguous direct-result query
name should never be primary, but only inside a constrained experimental
entrypoint whose types exclude the states that made the old name misleading.
Whether that constraint is useful or merely another cliff is one of the central
measurements of this RFC.

### D5. Snapback-specific strengths remain visible extensions

The familiar core is not the whole product. Snapback-specific capabilities use
names that state their semantics instead of borrowing an approximate Convex
analogy:

- `ephemeral(...)` and `useSnapbackPresence` for connection-owned TTL state;
- `useSnapbackLiveQuery` for freshness/retention-aware reads;
- `useSnapbackMutationDispatch` and `useSnapbackMutationStatus` for offline
  custody and settlement;
- typed asset fields, commands, grants, and delivery hooks;
- explicit authority/membership profiles;
- reviewed migrations and semantic generation receipts; and
- `snapback verify` for claim/evidence registration.

The guide and generated JSDoc teach one progression:

1. familiar online query/mutation/action for the ordinary case;
2. the exact Snapback extension when the requested behavior differs; and
3. the underlying explicit/low-level surface only when the extension needs it.

There is no second full guide. Familiar pages are generated call-shape
projections and short recipes over the same capability index, API reference,
diagnostic registry, and build-bound pages. Any profile-specific fact has one
owner and a parity gate.

### D6. This is familiarity, not compatibility

The published profile includes a generated compatibility table with four
states per recognizable construct:

| State | Meaning |
| --- | --- |
| `same-shape` | Name and ordinary call shape are intentionally familiar; documented Snapback semantics fit without qualification. |
| `narrower` | The familiar name exists only for a type-enforced subset, such as online-settled `useMutation`. |
| `snapback-extension` | Snapback has a first-class concept with no honest direct Convex mapping. |
| `unsupported` | No mapping; generation refuses or migration requires application design. |

At minimum the table covers schema values, table/index definitions, system
fields, query consumers, query liveness, mutation retry/settlement, actions and
packages, auth identity, file/assets, scheduled work, offline state, ephemeral
state, migrations, generated refs, and deployment.

Public docs must state:

- Snapback does not accept `convex/*` imports;
- Convex system fields and Snapback system fields are not aliases unless a
  separate migration mapping says so;
- a Convex function is public by export convention while Snapback requires an
  explicit auth/exposure decision;
- Convex's automatic reactivity does not imply every Snapback target/plan is
  subscribable;
- Convex's mutation promise does not imply Snapback's durable queued intent is
  settled; and
- copying a Convex app into the profile is not a supported migration path.

Any later claim of source compatibility, migration compatibility, or behavioral
compatibility requires a separate Spec with pinned Convex versions, fixtures,
semantic differences, and refusal behavior. This RFC does not reserve the
right to make that claim by resemblance.

### D7. The parallel period is an experiment with a stop rule

The explicit profile remains the published default initially. The familiar
profile ships as `Experimental` in capability/package metadata and is selected
explicitly by scaffold flag or configuration. Existing applications never
switch automatically.

The evaluation clock begins only when an externally consumable npm closure has
both profiles qualified against the same Snapback runtime release. Repository-
local prototypes do not start it.

The minimum comparison matrix has three Snapback lanes and three workload
families:

| Lane | Purpose |
| --- | --- |
| `snapback-explicit-v1` | Current-authoring control. |
| `snapback-familiar-ts-v1` | Authoring-profile treatment. |
| pinned Convex | External learned-surface control; not used for the internal promotion decision alone. |

| Workload | Why it is required |
| --- | --- |
| plain CRUD | Expected to favor the smallest familiar surface; catches ceremony without pricing Snapback-only capabilities. |
| messaging/equal-proof-bar | Prices live, offline, ephemeral, asset, and settlement differences. |
| day-two evolution | Prices schema change, migration, generated-artifact lifecycle, and proof—where Snapback's explicitness is hypothesized to pay back. |

Runs follow LLP 0197: preregistered N≥3 per configuration, counterbalanced
order, cold contexts, exact packages/models/harnesses, all runs reported,
machine records, proof-bar disclosure, aid disclosure, and receipt-backed
acceptance. At least one second model family runs the paired Snapback profiles
at N≥3 before a cross-family default claim; token ratios stay within family.

The profile decision reads four score groups:

1. **Authoring economy** — wall time, tokens, first-green time, authored lines,
   correction loops, guide/reference reads, package-source reads, and generated
   patch accept/repair counts.
2. **Semantic quality** — acceptance success, auth-negative proofs, liveness
   truth, queued/settled correctness, runtime contract failures, and review
   defects.
3. **Expressiveness** — completed required outcomes, explicit-profile escape
   hatches, unsupported mappings, and whether the familiar lane silently chose
   a weaker product.
4. **Maintenance economy** — adapter-exclusive production/test/doc lines,
   profile-only defects, mapping drift failures, release skew, duplicated
   examples, and added qualification time.

The experimental period ends at the earlier of:

- three complete qualified comparison rounds covering all workload families;
  or
- 90 days after the first dual-profile qualified npm publication.

At that point the author records one disposition:

1. **Promote** — familiar becomes the new-project default; explicit remains the
   advanced/compatibility profile for at least one declared major epoch.
2. **Merge** — only measured wins move into the canonical profile; the
   experimental package/profile is withdrawn.
3. **Tier** — both remain only because the evidence identifies distinct,
   named application audiences and maintenance stays within the bound below.
4. **Withdraw** — familiar is removed before a stable compatibility promise;
   migration tooling converts experimental apps to explicit source.

There is no implicit fifth outcome called "keep evaluating." Extending the
period requires a dated author amendment naming missing evidence, a new maximum
date or round count, and the observed maintenance cost. If the stop date passes
without a disposition, the familiar profile freezes: no new capabilities, no
new default templates, and no compatibility promotion until the author rules.

The proposed maintenance bound for a permanent Tier outcome is:

- zero profile branches below normalization;
- zero profile-specific wire or runtime capability ids;
- every canonical definition field covered by generated adapter completeness;
- no profile more than one qualified release behind the other; and
- profile-exclusive code/tests/docs below 15% of the corresponding shared
  authoring/codegen/client projection surface, measured by a committed script
  whose classification is reviewable.

The percentage is an initial proposal, not a post-result-adjustable threshold.
Changing it after results requires an author ruling and preserves the original
measurement in the decision record.

### D8. Migration is explicit, previewed, and state-preserving

The experiment ships a source migration command in both directions:

```sh
snapback author profile migrate --to familiar-ts --preview
snapback author profile migrate --to explicit --preview
```

The command emits a source patch, `normalizedContractId` comparison, semantic
diff, unresolved mappings, and exact verification steps. It does not edit by
default. Apply uses the stale-safe compare-and-write pattern of LLP 0245 and
normal generation/activation afterward.

A profile migration with equal normalized schema and operation contracts needs
no data reset or schema migration, but it still creates a new semantic/
generation identity because source custody changed. Existing in-flight work,
subscriptions, queued mutations, and settlements retain their original fences;
the migration follows LLP 0241's normal activation and compatibility rules.

Where exact source reconstruction is impossible—for example, converting a
declarative mutation plan into an idiomatic handler or recovering original
formatting—the migration produces a behavior-preserving candidate plus an
explicit manual-review marker. It never claims a lossless source transform from
canonical artifacts alone.

If the familiar profile is withdrawn, every qualified familiar construct must
have a migration disposition: automatic patch, manual patch with named reason,
or explicit refusal. Experimental users are not promised zero-touch migration,
but they are promised a complete inventory and no silent semantic downgrade.

## Alternatives considered

### Restart Snapback around the familiar API

Declined. The evidence identifies valuable core semantics and boundary defects,
not a failed foundation. A restart would discard the exact authority, offline,
ephemeral, migration, portability, and proof machinery the comparisons praise,
then recreate cross-target drift while chasing a syntax advantage.

### Change the current surface in place

Declined for the experiment. It destroys the control lane, makes causality hard
to measure, and risks mixing compatibility repair with API evaluation. If the
familiar profile wins, a later Decision can merge or promote it deliberately.

### Improve only the guide, skills, and examples

Insufficient as the whole answer. Those investments remain necessary, but the
measured dominant term is prior orientation and the comparator now actively
maintains its own agent files, skills, MCP surface, and evals. This alternative
does not test whether familiar syntax itself removes actions and errors.

### Implement exact Convex compatibility

Declined. The semantic mismatches are product-shaped: function exposure and
auth, universal reactivity, result enforcement, package/runtime boundaries,
offline settlement, assets, ephemeral state, migrations, system fields, and
deployment. Pretending these are aliases would either weaken Snapback or create
a compatibility layer more complex than the proposed familiar profile.

### Keep both surfaces permanently from the start

Declined. Permanent duality should be an evidence-backed Tier outcome, not the
default consequence of publishing an experiment. Without the stop rule and
maintenance measurements, every new feature would acquire two names, two docs
paths, and two failure modes before either surface had proven its value.

## Rollout

### Phase 0 — Freeze the comparison boundary

1. Inventory every current schema/function/client construct and its canonical
   owner.
2. Specify `NormalizedApplicationDefinitionV1`, `normalizedContractId`, and the
   four-state adapter disposition table.
3. Add a gate proving that no runtime/wire/storage branch reads authoring
   profile to change semantics.
4. Preregister the explicit/familiar/Convex comparison matrix and maintenance
   classifier before profile results exist.

### Phase 1 — Server authoring adapter

1. Publish the umbrella package projections and generated local server/API
   modules.
2. Implement schema, validators, query, mutation, action, `ctx.db`, and module-
   namespaced refs over LLP 0237/0246.
3. Integrate LLP 0245 suggestions for missing result and reach declarations;
   require accepted source before activation.
4. Prove normalized equivalence on CRUD plus adversarial differences for auth,
   reach, effects, liveness, and unsupported syntax.

### Phase 2 — Narrow familiar clients

1. Add `SnapbackProvider`, online-current `useQuery`, online-settled
   `useMutation`, and one-shot `useAction` as projections over LLP 0238.
2. Generate mismatch diagnostics and JSDoc that route retained/offline/queued
   requirements to the canonical lifecycle APIs.
3. Prove that familiar hooks allocate no second cache, connection, outbox, auth
   coordinator, or task owner.

### Phase 3 — Paired external templates and migration

1. Ship matched explicit and familiar CRUD and messaging templates from one
   neutral outcome specification, with separate generated source snapshots.
2. Add preview/apply profile migrations and normalized/diff receipts.
3. Qualify both profiles from the same external npm closure and start the
   evaluation clock.

### Phase 4 — Measure and decide

1. Run the preregistered CRUD, equal-proof messaging, and day-two series.
2. Publish results only under LLP 0197/0189 claim rules.
3. Record maintenance measurements for every dual-profile release.
4. At the stop rule, write the author disposition and execute its cleanup or
   promotion in the same program.

## Acceptance

The RFC's experiment is implemented only when all of the following hold:

1. One CRUD app and one messaging app authored independently in both profiles
   produce an exact normalized-equivalence witness for the facts intended to be
   equal, while each retains its own correct LLP 0241 identities.
2. Both applications run through the same server routes, runtime evaluators,
   storage paths, live matcher, auth gates, outbox, and client core; a structural
   gate prevents profile-conditioned semantic branches below normalization.
3. Required `args`, `returns`, `auth`, reach, effect, secret, capability, and
   runtime facts cannot disappear through the familiar adapter. Omission either
   produces an LLP 0245 patch or refuses before artifact replacement.
4. `query` defaults to required proven liveness, `delivery: "read"` is an
   explicit opt-out, and an unprovable live query refuses rather than polling or
   silently downgrading.
5. Familiar `useQuery` never returns retained/optimistic data as current;
   familiar `useMutation` never accepts queued custody or returns intent as
   settlement; the generated correction points to the full lifecycle API.
6. The familiar profile supports normal `.ts` helper composition and source-map
   diagnostics under LLP 0237/0246, while packages/Node power remain confined
   to LLP 0249's explicit action profile.
7. Profile migration preserves application data when canonical schema facts are
   equal, reports identity/activation consequences, and refuses every unknown or
   lossy mapping.
8. External published-package lanes complete the same receipt-backed acceptance
   suite; repository-local success is insufficient.
9. The benchmark record includes authoring, semantic, expressiveness, and
   maintenance groups, and the author records Promote, Merge, Tier, or Withdraw
   by the stop rule.
10. No package, guide, README, or generated JSDoc calls the profile
    "Convex-compatible" or implies unmodified Convex applications work.

## Risks

### Two surfaces become two products

The largest risk. The one-profile-per-app rule, single normalized boundary,
structural no-branch gate, guide projection, release lockstep, maintenance
budget, and stop rule are all necessary. If a feature repeatedly needs separate
semantics, this RFC's design has failed even if both implementations work.

### Familiar names teach the wrong semantics

Agents may transfer expectations more strongly than docs can correct them.
Nominal refs, narrowed aliases, call-site JSDoc, stable diagnostics, and
adversarial tests are the defense. If agents still treat `useMutation` as
offline-capable or `useQuery` as retained-current, the alias should be withdrawn
rather than explained harder.

### The profile makes Snapback look like a lesser Convex

A copied first hour followed by many caveats could hide the reason to choose
Snapback. Paired templates must exercise at least one differentiator after the
ordinary path, and the guide progression must route directly from familiar core
to Snapback-specific capability—not to a generic compatibility story.

### Explicit facts still dominate authored bulk

Familiar names alone may not help if `returns`, auth, reach, effects, and bounds
remain the dominant token cost. That is a legitimate experimental result. LLP
0245 suggestions, schema references, typed interiors, and compact typed profiles
are the approved levers; weakening or omitting evidence is not.

### Maintenance measurement is gameable

Line counts alone reward moving complexity into shared files. The record must
include unique defects, drift failures, release skew, qualification time, and
manual duplicated edits alongside classified LOC. Classification changes are
reviewed source and preserve their history.

### Convex keeps moving

This profile borrows a learned vocabulary, not a frozen competitor
implementation. The comparison pins Convex versions and refreshes official
surface facts per LLP 0198/0197. Snapback does not chase every new Convex name;
changes enter only when they improve Snapback's own measured path.

## Open questions

1. **Package shape.** Should the familiar imports be an umbrella
   `@expo/snapback` package with `/server`, `/values`, and `/react` exports, or
   experimental subpaths of the existing codegen/React packages? This RFC
   recommends the umbrella because package/import coherence is part of the
   learned surface, but publication inventory cost should be measured.
2. **Client alias value.** Are constrained `useQuery`/`useMutation` aliases a
   useful ordinary lane, or do their exclusions create more mistakes than the
   familiar names save? This is intentionally measured rather than assumed.
3. **Query default.** Does live-by-default plus explicit `delivery: "read"`
   outperform the existing two constructors without creating repeated
   activation refusals? Promotion of the model remains under LLP 0130 ER-3.
4. **Reach compression.** Which common `reads`/`writes` facts can use compact
   table/index/profile references while retaining the exact authority and
   conformance meaning of the explicit profile?
5. **Suggestion placement.** Should LLP 0245 patches remain inline in each
   function, or may the familiar profile reference a committed, ordinary-source
   companion contract module without making review harder?
6. **Stop-rule duration.** Is 90 days from first qualified dual publication the
   right maximum, or should the experiment be bounded only by three complete
   rounds? This RFC recommends the calendar backstop so incomplete measurement
   cannot become indefinite compatibility by inertia.
7. **Disposition threshold.** What authoring-economy improvement is large
   enough to promote the familiar profile given equal semantic quality? The
   benchmark matrix must preregister this before the first profile comparison;
   this draft deliberately does not choose a percentage after seeing no data.

## Status

Review. Acceptance would authorize a bounded dual-profile experiment over one
Snapback core. It would not make the familiar profile the default, establish
Convex compatibility, weaken any evidence boundary, or authorize permanent
dual-surface support. Those outcomes require the measured stop-rule disposition
and any amendments it triggers to LLP 0004, 0108, 0119, 0130, 0198, 0238, 0241,
0245, and 0246.
