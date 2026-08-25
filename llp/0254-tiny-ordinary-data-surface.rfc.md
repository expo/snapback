# LLP 0254: Tiny ordinary data surface [Tombstoned]

**Type:** RFC
**Status:** Tombstoned
**Systems:** Product, Developer experience, Authoring, Application data API,
Schema, Code generation, Client SDK, React, Local sync, Offline sync,
Authorization, Testing, Competitive evaluation
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-13
**Revised:** 2026-08-15 (Tombstoned after Charlie Cheever's D10 withdrawal
ruling. The public Tiny doorway and its generated projections are removed
before the next qualified publication; no compatibility or migration period
is required because the author confirms there are no users.)
**Revised:** 2026-08-13 (Accepted by author direction after the commissioned
r3→r4 delta review returned READY — all three families READY, scoped per the
run journal. r4, final super-refine revision: the
round-3 in-delta ledgers applied — online-only ambiguous-outcome
disposition, D9 clock anchored to Phase 4's package-closure publication,
missed-disposition backstop, synthesized-identity spelling, and
artifact/citation polish. r3, r2, and the initial draft earlier the same
day; the loop's final verdicts bind r3)
**Related:** LLP 0000, LLP 0004, LLP 0037, LLP 0053, LLP 0056, LLP 0061,
LLP 0065, LLP 0080, LLP 0082, LLP 0102, LLP 0108, LLP 0114, LLP 0117,
LLP 0127, LLP 0146, LLP 0155, LLP 0157, LLP 0166, LLP 0193, LLP 0194,
LLP 0196, LLP 0197, LLP 0203, LLP 0218, LLP 0231, LLP 0236, LLP 0238,
LLP 0240, LLP 0241, LLP 0242, LLP 0243, LLP 0245, LLP 0247, LLP 0252,
LLP 0253, diaries 0027–0031
**Superseded by:** none (withdrawn; no successor surface)

> **Tombstoned — read for history only.** Charlie Cheever withdrew this
> surface (D10, 2026-08-15). The public Tiny doorway and its generated
> projections are gone; there is no successor and no migration period. Do
> not implement from this document.

## Summary

Snapback should test whether its ordinary application-data path can become
substantially smaller than either its current explicit surface or the
Convex-familiar function surface, without weakening Snapback's authority,
boundedness, liveness, offline, settlement, portability, or proof semantics.

The product hypothesis is:

> A familiar API helps an agent guess correctly. A tiny API removes most of
> what the agent has to guess.

For ordinary analyzable application data, the target learning surface is four
concepts:

1. **table** — typed stored data and indexes;
2. **access** — the mandatory policy governing that data;
3. **query** — a bounded, policy-composed, live/local materialization; and
4. **transact** — a generated, server-authoritative data intent with
   optimistic prediction when generatable.

The first two are authored once in the application schema. The latter two are
the ordinary client API. Live delivery, local materialization, optimistic
prediction, durable offline custody, reconnect settlement, generated
contracts, invalidation, and inspection are consequences of those declarations,
not additional application subsystems.

This is **not a third authoring profile** beside
`snapback-explicit-v1` and `snapback-familiar-ts-v1`. It is a generated,
profile-neutral data layer over the same canonical definition, artifacts,
runtime, wire protocol, and client core. An application still selects exactly
one function-authoring profile under LLP 0252/0253. It uses that profile only
when a requirement outgrows the analyzable data path—for example a multi-row
business invariant, privileged authority transition, external effect, job, or
custom conflict policy.

The intended progression is therefore:

1. **tiny generated data path** for ordinary data;
2. **Convex-familiar or explicit functions** for custom trusted logic the
   selected profile's v1 grammar admits; and
3. **Snapback-specific capability surfaces** for offline custody, ephemeral
   state, assets, authority, jobs, and verification when their distinct
   semantics matter.

The exact syntax remains an experimental surface to be fixed by a follow-on
Spec. This RFC fixes the semantic boundary, the concept budget, the relationship
to LLP 0252/0253, the required escape behavior, and the evaluation that decides
whether the surface deserves promotion.

## Motivation

### Familiarity and smallness are different levers

LLP 0252 responds to a repeated finding: coding agents already know the
Convex-shaped vocabulary—`query`, `mutation`, `action`, `ctx.db`, generated
`api`, and React hooks—while Snapback's novel vocabulary imposes orientation
before the first useful screen. Reusing learned names can reduce retrieval and
correction cost.

That leaves a more important possibility unisolated. An agent can be familiar
with a surface and still have to author many independent facts, modules, and
lifecycle decisions. Conversely, an unfamiliar but complete four-concept
surface may be learned once and used correctly without repeated retrieval.

This RFC distinguishes three kinds of size:

- **symbol size** — how many exports and names appear;
- **first-hour size** — how many concepts must be understood before the first
  useful, verified application works; and
- **semantic size** — how many independent decisions the application author
  must make and keep consistent.

The goal is to reduce first-hour and semantic size. Merely re-exporting many
existing concepts under one `db` object, or placing several commands behind one
shell command, does not satisfy it.

### The InstantDB result is repeated evidence, not a causal proof

The LLP 0102 InstantDB arms recorded these active elapsed intervals:

| Workload | Active elapsed |
| --- | ---: |
| Todo | 31.68 min |
| Chat | 30.55 min |
| Linear | 16.25 min |
| Partiful | 36.35 min |
| Research Room | 17.64 min |

The raw values live in each arm's
`demos/backend-bakeoff/arms/<workload>/instantdb/run-capsule.v1.json`.
They are not a clean surface-only comparison: target mode, product completeness,
provider gaps, assistance, and retained milestones differed, and LLP 0102
requires raw authoring records rather than reducing cost to one number.

The more important evidence is qualitative and repeated:

- Diary 0027 says typed graph schema, direct React queries, optimistic
  transactions, native live updates, durable IndexedDB state, an offline
  transaction queue, guest auth, and relation-aware permissions fit together
  without application-side repository or synchronization plumbing. The app
  code was recognizably the product rather than a custom sync engine.
- Diary 0028 asks Snapback to match InstantDB's tiny path from typed schema to
  live React data and native ephemeral rooms.
- Diary 0029 praises the compact combination of typed links and indexes,
  direct client transactions, live subscriptions, optimistic materialization,
  and real browser offline behavior.
- Diaries 0030 and 0031 preserve the boundary: the collaborative data plane
  was fast and compelling while the trusted plane stayed weaker — diary 0030
  records semantic-conflict ambiguity, permission-invalidation timeliness,
  and asset-revocation gaps; diary 0031 records the missing jobs, secrets,
  and automation plane. Permission-diagnostic gaps are diary 0029's finding;
  diary 0030 instead praises Instant's permission debugger and asks Snapback
  to match it — a strength to equal, not a weakness to beat.

LLP 0082 explains the architectural reason. Instant exposes one primary
mechanism—subscribe to a query—and one optimistic transaction grammar over a
client-side materialization. Authors do not separately build endpoints,
repositories, caches, invalidation, optimistic stores, or offline outboxes for
the ordinary path.

As of 2026-08-13, current InstantDB documentation still presents the same
surface: schema and permissions as code, live `db.useQuery(...)`, and
`db.transact(...)`; its agent product adds a skill, rules files, raw Markdown
docs, and MCP tools
([modeling data](https://www.instantdb.com/docs/modeling-data),
[reading data](https://www.instantdb.com/docs/instaql),
[writing data](https://www.instantdb.com/docs/instaml),
[permissions](https://www.instantdb.com/docs/permissions),
[using LLMs](https://www.instantdb.com/docs/using-llms)). This corroborates the
small-surface hypothesis but also shows the original bakeoff did not isolate
surface size from knowledge placement. D9 defines the experiment that does.
These external observations are dated and otherwise unpinned; LLP 0082's
2026-07-23 primary-source pass is the corpus record, and the D9 Plan pins a
dated Instant surface inventory in Phase 0 before the calibration arm carries
evaluative weight.

### Snapback already owns most of the hard semantics

This proposal is plausible because it is primarily compression over existing
owners, not a request to rediscover correctness:

- LLP 0065 and the shipped standard-pattern generator derive owner-scoped CRUD,
  contracts, bounds, defaults, transactional guards, and generated clients
  from closed declarations without inferring authority.
- LLP 0231 makes the table the mandatory visibility-policy locus and composes
  policy into reads rather than relying on every function author to remember a
  security filter.
- LLP 0240 compiles an application membership/role declaration into one
  authority IR for reads, writes, invalidation, and generated operations.
- LLP 0242 defines bounded, admitted query composition, capability facts, and
  explain output rather than treating arbitrary client predicates as portable.
- LLP 0155 requires one local materialization, query-scoped custody, one
  authored operation before two, and a strict distinction between prediction
  and authority.
- LLP 0238 and LLP 0218 own the truthful query, dispatch, custody, and
  settlement state machines.
- LLP 0245 removes declaration transcription only through infer/show/freeze;
  authorization and effects remain explicit.

The current pieces are individually powerful but remain visible as many
concepts. The opportunity is to make the compiler and generated client carry
their composition.

## Goals

1. Let a cold coding agent build a useful live, offline-capable, authorized
   data application after learning no more than the four ordinary concepts.
2. Make ordinary application code describe product data and interactions, not
   backend endpoints, cache plumbing, synchronization, or an outbox.
3. Preserve every existing security and truth boundary: explicit policy,
   server authority, bounded work, validated ingress/egress, negative auth
   invalidation, capability honesty, and distinct queued/settled states.
4. Generate all repetitive operations, contracts, dependency facts, clients,
   local prediction, and proof fixtures from one closed declaration.
5. Provide a monotonic escape into the application's selected function profile
   without changing storage, data identity, or client ownership architecture.
6. Compare tiny, familiar, and explicit authoring on the same Snapback runtime
   so the product can choose based on causal evidence rather than cross-provider
   impressions.
7. Keep the experimental layer cheap to withdraw if it creates hidden magic,
   a severe abstraction cliff, or a second semantic implementation.

## Non-goals

- Source or behavioral compatibility with InstantDB, Firebase, Supabase,
  Convex, or any other backend.
- A third application authoring profile or a third function adapter.
- Raw client access to storage tables, indexes, transactions, or authority
  backing relations.
- Default-allow authorization, policy inferred from field names, or security
  rules applied only after an unconstrained query.
- Making all possible queries portable, live, retained, or offline-capable.
- Hiding loading, freshness, authority, connection, optimistic, custody, or
  settlement distinctions behind a falsely simple success value.
- Replacing custom functions, actions, jobs, assets, ephemeral state,
  authority-transition operations, or verification.
- Rewriting the Rust runtime, storage engine, sync engine, wire protocol, or
  canonical artifact pipeline.
- Claiming that a small export count alone is a small product surface.

## Terminology

- **Ordinary data path** — the generated read/write surface for tables and
  policies whose behavior is completely representable in admitted Snapback IR.
- **Data resource** — the generated client and manifest projection of one
  eligible table plus its policy, indexes, server defaults, mutability, query
  capability, and standard operations. It is not a new storage entity.
- **Data query** — a closed `DataQueryV1` descriptor over generated resources.
  It is policy-composed, explicitly bounded, and admitted against generated
  capability facts.
- **Data transaction** — a closed `DataTransactionV1` intent containing one or
  more generated operations within declared v1 limits. It is not a raw storage
  transaction.
- **Tiny client** — the generated `db` projection that constructs data queries
  and transactions and delegates to the canonical client core. It owns no
  cache, transport, auth coordinator, outbox, or settlement state.
- **Function escape** — a custom operation authored with the application's one
  selected LLP 0252 profile after a requirement exceeds the ordinary data path.
- **Concept budget** — the number of independently taught and authored ideas in
  the default path. It is measured separately from lines of code and exports.
- **Promotion** — converting a generated standard operation into a custom
  function implementation while preserving its operation/data identity where
  the contracts remain compatible.

## Decision

### D1. Add a profile-neutral generated data layer, not a third profile

The ordinary data path is generated from the canonical schema, policy, and
standard-operation declarations. Both `snapback-explicit-v1` and
`snapback-familiar-ts-v1` applications may consume it. The application's
function source still passes through exactly one LLP 0252 adapter.

```text
schema + policy + data-resource declarations
                    │
                    v
          canonical data-resource IR
                    │
         ┌──────────┴──────────┐
         v                     v
 generated tiny client   canonical manifests/plans
         │                     │
         └──────────┬──────────┘
                    v
       existing runtime / wire / client core

custom logic ──> application's one selected function adapter ──┘
```

After data-resource normalization, runtime, storage, authorization,
invalidation, local materialization, and settlement behavior cannot branch on
the function-authoring profile. Profile information may remain only for the
mandatory semantic/generation identity fences of LLP 0241/0252, source
custody, diagnostics, migration, and the familiar-client brand checks already
owned by LLP 0252/0253.

The data layer gets its own versioned capability/profile identity because its
query and transaction descriptors have semantics. That identity enters the
ordinary LLP 0241 semantic and generation preimages under a default-omission
rule with the same identity-fence structure as LLP 0253 S1.2 (the predicate
here is unused-facts, not default-value): an application emitting no
data-resource facts keeps a byte-identical semantic preimage and
`semanticId`, while bundle and generation identities still rotate on any
regeneration that emits new generated members, as LLP 0241 requires — the
no-rotation promise covers the semantic layer only. It is not an authoring
profile and does not create a second
manifest authority, and profile-neutrality is a property of the normalized
data facts defined below, never of generation envelopes.

### D2. Hold the ordinary learning surface to four concepts

The default documentation, starter, generated JSDoc, and first-hop diagnostic
path teach only:

| Concept | Authored fact or action |
| --- | --- |
| table | fields, indexes, server-owned/defaulted fields |
| access | mandatory table visibility and allowed standard writes |
| query | bounded selection of authorized generated resources |
| transact | generated data intent with explicit prediction/custody/settlement |

Authentication setup may be supplied by the starter and remains an application
fact, but it must not require a second authorization language. Realtime,
retention, offline storage, optimistic execution, invalidation, and generated
types are capabilities and states of `query`/`transact`, not separate ordinary
authoring systems.

The default path may expose state fields and diagnostic details without adding
new authoring concepts. A concept counts when an author must choose, configure,
or coordinate it for the ordinary path to work. Sync-enabledness falls under
the same rule: the follow-on Spec either folds it into the data-resource
declaration or a profile default (as LLP 0253 did), or counts it as a fifth
authored concept in the Phase 0 freeze — never authored per table yet
uncounted.

The experiment records every concept a builder must retrieve or manipulate.
If the implementation needs authors to learn separate operation registration,
live-query declarations, result contracts, cache keys, optimistic handlers,
outbox registration, or invalidation dependencies for a standard resource, it
has exceeded this budget even if codegen hides some lines.

### D3. A data resource is explicit about authority and generated about repetition

The exact spelling is deferred to the follow-on Spec. The intended source
altitude is illustrated by:

```ts
export const todos = defineTable({
  title: v.string(),
  completed: v.boolean(),
  ownerId: v.principal(),
  createdAt: v.integer(),
})
  .index("by_owner_completed_created", [
    "ownerId",
    "completed",
    "createdAt",
  ])
  .visibility({ kind: "owner", field: "ownerId" })
  .data({
    createDefaults: { createdAt: "now" },
    immutable: ["createdAt"],
  });
```

The example adds only one tentative spelling, `.data(...)`, over existing
schema, index, visibility, and trusted-default concepts. Sync-enabledness is
profile-defaulted on for data resources (the LLP 0253 default), not authored
per table — resolving D2's fold-or-count rule by folding, with an explicit
opt-out available. A Spec may find a smaller spelling, but must retain these
semantic facts:

- visibility is explicit and mandatory; omission fails generation;
- public readability is the explicit shipped `public-read` visibility kind,
  never absence of policy, and no generic write capability is derived from it
  (write profiles beyond owner-scoped v1 are OQ8 material);
- owner assignment is a consequence of the owner-visibility declaration,
  executed in the authoritative transaction under LLP 0065 — never an
  authored default: trusted defaults accept only `now` and `id`, may not
  name the owner field, and the owner field's immutability is likewise
  derived;
- server-owned identity, principal, and time values are not client arguments;
- mutable and immutable fields are closed;
- generated standard operations keep LLP 0065's Implemented rule verbatim:
  an explicitly named list index, never inferred, refusing with the existing
  stable code when absent. If the follow-on Spec wants sole-candidate index
  fill for the `.data(...)` declaration — the single owner-leading declared
  index supplying the list index; unique-lookup helpers are a separate
  LLP 0065 surface — that is this RFC's proposed relaxation, not LLP 0065's
  current rule, scoped to declaration lowering (the generator still
  receives a concrete index) and landed only as a dated LLP 0065
  amendment. Descriptor queries name their index explicitly via the builder;
  every ambiguity refuses, and all bounds are fixed;
- authority-creating, membership-backing, permission-backing, or otherwise
  ineligible tables do not receive generic writes;
- generated create/update/delete execute policy and invariants inside the
  authoritative transaction; and
- every generated operation has frozen arguments, result, reach, refusal,
  capability, and identity facts.

Generation may infer validators, result shapes, read/write ceilings, query
plans, local prediction, and clients from these closed facts under LLP 0065.
It may not infer access, public exposure, authority creation, external effects,
or portability from names, observed executions, or conventional fields.

### D4. The tiny query is a bounded descriptor, not arbitrary client code

The target client altitude is:

```tsx
const todos = db.useQuery(
  db.todos
    .using("by_owner_completed_created")
    .where({ completed: false })
    .orderBy("createdAt", "desc")
    .take(100),
);
```

The generated builder constructs a serializable `DataQueryV1` descriptor. The
descriptor contains no function closures, source text, SQL, arbitrary
predicates, or string-evaluated code. Its closed grammar initially includes:

- one eligible generated resource;
- equality and admitted indexed comparison filters;
- one declared index and total order;
- an explicit `take` no greater than generated and target ceilings;
- stable cursor pagination;
- a closed projection; and
- only the relationship/composition nodes already admitted by LLP 0242 and
  LLP 0157.

The generated type surface prevents most invalid shapes, but types are not the
security boundary. The server independently validates the descriptor against
the active generation, recomputes its canonical plan identity, composes the
table policy, checks target capabilities and work ceilings, and admits or
refuses before reading data.

The policy is never a caller-supplied filter. It is conjoined from the active
table/authority IR. A caller cannot omit, weaken, or replace it.

The descriptor's slot in the materialization-identity stack is owned by
LLP 0157 (`QueryMaterializationKeyV1`) with LLP 0155's custody rules, and
sharing is by function-slot resolution, never by plan hash: when a
descriptor lowers to an existing generated operation's plan and contract, it
resolves to that operation's exact function reference and shares its
complete LLP 0157 preimage, so the two spellings own one materialization; a
descriptor with no matching generated operation receives its own
synthesized function identity — a deterministic ordinary generated export
whose stable id follows LLP 0108's `{appId}:{exportedName}` spelling (a
dated LLP 0108/0004 amendment if that scheme must change), never a
parallel manifest authority. The resolution candidate set is generated
operations only, and a degenerate multi-match refuses rather than
tie-breaking silently. Two named queries that coincidentally share
a plan keep distinct keys, exactly as LLP 0157 pins; any residual LLP 0157
amendment must be named by the Spec, never implied. The client stores only
rows whose admitted query, optimistic
intent, or bounded retention policy currently owns them. The inspector can
explain that ownership.

V1 does not silently fall back to a scan, client-side whole-table filtering,
post-hoc authorization, polling, or an online-only handler. An unsupported
shape returns a generated diagnostic naming the nearest admitted query and the
function escape.

### D5. The tiny transaction is a generated intent, not raw writes

The target client altitude is:

```ts
const write = await db.transact(
  db.tx.todos.create({ title, completed: false }),
);
```

`db.tx.todos` contains only operations generated for that resource and active
generation. The client cannot select storage tables, set server-owned fields,
invent a write kind, expand declared reach, or mutate authority-bearing tables
through this surface.

`DataTransactionV1` contains stable operation identity, canonical arguments,
the active data-surface version, and a bounded list of generated intent chunks.
The follow-on Spec must fix atomic batch size and composition rules. Unknown,
stale, mixed-generation, over-limit, or capability-ineligible chunks refuse
before custody.

Each generated intent owns one shared semantic form:

- the server executes it authoritatively;
- the local client may predict it over the query materialization;
- the outbox may retain it when the operation's generated capability allows;
- reconnect settlement reconciles by stable intent and operation identity;
- another observer converges only after authoritative delivery; and
- conformance compares prediction with server outcomes and records any allowed
  divergence.

There is no separately authored optimistic reducer for a standard operation.
The v1 capability lattice is closed and normative: **prediction** ∈
{generated exact shared prediction, none} × **custody** ∈ {queue-eligible
durable custody, online-only}, with authoritative settlement obligatory for
every accepted intent — settlement is the point of custody (LLP 0155 P4,
LLP 0218), never a third toggle. All four cells are admitted: with
prediction and queue-eligible custody, the full local-first path; without
prediction, the intent still queues under LLP 0218's `withheld` or
`unavailable` presentation and settles identically, losing only optimistic
paint; online-only cells settle in the foreground attempt, are refused, or
— when the response is lost after dispatch — take the canonical
ambiguous-outcome disposition: a possibly-accepted intent is never
reported as rejected, and remains recoverably pending by stable intent
identity until a server-ledger terminal answer or proven non-acceptance
(LLP 0155's idempotent-recovery rule; the shipped receipt-less transport
ambiguity), with the response-loss and crash-boundary acceptance cases
carried by the named amendment below. Both
facts are generated, never separately authored: prediction is derived from
the operation IR (Phase 3), custody defaults to queue-eligible, and an
online-only exception is a generated or profile-default fact carrying a
stable declared reason in the artifact — not a fifth authored concept.
Operation-declared custody capability enters the shipped dispatch and
settlement contract only through a named LLP 0218 amendment (LLP 0043
where dispatch surfaces are touched) or canonical owner — the same rule D6
applies to `pendingWrites`. Prediction
failure alone never forces a function escape.

### D6. Smallness cannot collapse query and settlement truth

`db.useQuery(...)` returns the complete canonical query-state grammar owned by
LLP 0238, projected without a second cache or state machine. At minimum an
application can inspect:

```ts
query.data
query.status
query.error
query.connection
query.freshness
query.retention
```

The exact field names follow the shipped canonical `QueryState` union —
`status` (including `skipped`)/`data`/`error`/`connection`/`freshness`/
`retention` — which LLP 0238 owns as lifecycle law; where LLP 0238 D4's
illustrative field list differs (`diagnostic` vs the shipped `error`), the
shipped names govern and this RFC forks neither. The projection is that full
grammar, never a subset that drops `error` or `retention`. `pendingWrites`
is a proposed LLP 0238/0218-owned addition—the
shipped query state does not carry that field today—and must land as a canonical
amendment or be projected from the same canonical outbox owner without creating
a second registry. Ordinary rendering may use `data`, while loading, offline,
retained, blocked, refreshing, and error states remain available and distinct.
Unlike LLP 0252's deliberately narrow `Result | undefined` familiar alias, the
tiny path is intended to make local-first behavior ordinary and therefore
cannot discard retained or optimistic data merely to mimic an online API.

Likewise, `db.transact(...)` must distinguish:

- local optimistic paint;
- accepted durable custody;
- queued/offline state;
- authoritative settlement or refusal; and
- independent-observer convergence.

The common path may make the first render require no extra code, but the write
result cannot present queued custody as committed success. The follow-on Spec
must choose a compact handle/result grammar that exposes both accepted custody
and settlement without requiring a separate application-maintained registry.

### D7. The function profile is the explicit escape hatch

The ordinary data path is intentionally incomplete. Authors use the
application's selected LLP 0252 function profile for:

- multi-row or conditional business invariants not represented by generated
  standard operations;
- authority creation, membership changes, role transitions, or privileged
  reads;
- custom conflict detection or semantic compare-and-set;
- effects, secrets, HTTP, assets, jobs, schedules, or long-lived workflows;
- query shapes outside the admitted bounded algebra — but not prediction
  failure alone, which D5 handles capability-honestly inside the data path.

The diagnostic for an outgrown data operation names why it is ineligible and
generates or points to the smallest valid function scaffold. It never suggests
weakening policy, increasing an unproven bound, or using an admin credential in
application code.

The escape target is honest about the selected profile's v1 grammar. Where
that grammar refuses a category — under LLP 0253's current Draft the familiar
profile refuses external effects, HTTP, jobs/schedules, the LLP 0249 runtime,
and non-default authority-creating operations — the diagnostic routes to the
owning capability surface or the explicit profile and says so, instead of
implying the category is reachable inside the selected profile. For a
familiar application those categories are today a profile-migration cliff
owned and measured by LLP 0252 D7, and this RFC does not paper over it.

For standard create/update/delete operations, tooling should support
**promotion**:

```sh
snapback data promote todos.update --format familiar
snapback data promote todos.update --format explicit
```

The command is illustrative; the follow-on Spec fixes its spelling and source
protocol, and `--format` may target only the application's selected profile,
so promotion never becomes a profile-mixing vector. Promotion emits ordinary source with the generated args/result,
authority, reach, refusal, and capability facts frozen. Where the custom
implementation preserves the contract, it retains the operation's stable
public identity and data. A semantic change rotates the ordinary LLP 0241
identity and follows its migration/activation rules.

Promotion is one-way in v1. Tooling may later show that custom source has become
equivalent to a generated pattern, but it never deletes source or demotes an
operation based on inference or sampled behavior.

### D8. One generated client and one package doorway

The tiny surface reuses the experimental `@expo/snapback` umbrella proposed by
LLP 0253 if that package ships. It does not add another umbrella, React
provider, connection owner, generated-reference family, or diagnostics type.

An illustrative package shape is:

```ts
import { db } from "@expo/snapback/react/data";
```

The actual `db` is app-generated or provider-bound so its resources and query
grammar are typed to the active schema. React, Expo, Swift, and headless clients
consume the same versioned `DataQueryV1` and `DataTransactionV1` semantics even
when their language-native builders differ.

The tiny `db` may not squat the familiar profile's exports: LLP 0253 S3.1
binds `useQuery` at that entry to the narrow `Result | undefined` alias, and
one entry point exporting one hook name with two truthfulness grammars is the
two-doorway failure D11 tracks. The Spec gives the tiny surface a distinct
generated or subpath doorway unless the familiar alias is withdrawn.

The experiment's own scaffold and guide path teaches the tiny path; the
repository-wide first hop is unchanged while the surface is Experimental
(D10). Generated errors route to
one exact next action or function escape under LLP 0193/0203. The full
capability index remains available, but ordinary CRUD documentation does not
front-load unrelated assets, jobs, ephemeral, migration, deployment, or
low-level lifecycle vocabulary.

Templates, skills, MCP, and generated JSDoc are delivery mechanisms for this
same surface, not alternate semantics. Every repeated fact is generated or
parity-gated under LLP 0203 P1.

### D9. Evaluate surface size on one Snapback runtime

The original provider bakeoff motivates this RFC but cannot decide it. The
tiny evaluation is a **coordinated companion** to LLP 0252 D7's authoring
experiment — one comparable program, two clocks. It reuses D7's capsule
discipline, aid-symmetry rules, LLP 0197 replication floor and
no-cross-version-pooling rule, and proof bar, but it is not a lane addition
to D7's running matrix: D7's four lanes (explicit, familiar, the
familiar-server ablation, pinned Convex) stay on D7's own clock and
disposition set, while this experiment runs on its own clock — starting at
Phase 4's first qualified publication of the tiny Experimental package
closure (the shipment step, before any D9 result is observed), ending at
the earlier of three complete rounds or 90 days,
extendable only by dated author amendment — and disposes through D10's five
outcomes, which are deliberately not D7's four. Every internal lane in one
comparison uses the same Snapback release, target, proof bar, model,
reasoning setting, starting shell, and credentials. The first comparison is
exactly this cell table, normative for Phase 0's freeze:

| Lane | Function profile | Workloads | Role |
| --- | --- | --- | --- |
| tiny data surface | `snapback-explicit-v1` (P) | Todo; day-two from that Todo app | treatment |
| explicit data path | `snapback-explicit-v1` (P) | Todo; day-two from that Todo app | named causal control |
| pinned InstantDB | — | Todo | external calibration only, excluded from the causal decision |

Chat cells enter this table only by dated Plan amendment after OQ8
admission (below). Familiar-profile cells are not in the first comparison:
a later, separately preregistered 2×2 (tiny/non-tiny × explicit/familiar)
under a new configuration version may cross them, and D7's own results stay
qualitatively comparable through the shared capsule and aid rules. Phase 1's
Todo checkpoint measures declaration compression through generated named
operations only; it is not the D9 promotion experiment, whose evidence is
Phase 4's.

The tiny lane is not an application profile. Its functions, when needed,
use the preregistered profile P. P must admit every day-two escape item in
its v1 grammar — under LLP 0253's current Draft that pins the first
comparison's P to `snapback-explicit-v1` — or the day-two item list is cut
to what P admits and the promotion claim scoped accordingly.

The minimum workload set is staged to what the v1 ordinary path can express:

1. **Owner-scoped Todo** — the expected best case for generated data, and
   the only workload the Phase 1 owner-profile surface must support.
2. **Collaborative Chat** — relationships, membership, pagination, live
   delivery, ephemeral state, offline retention, and queued writes. Chat
   becomes a tiny-path lane only after the follow-on Spec admits a reviewed
   membership-read data-resource profile with LLP 0065-class negative tests
   (OQ8). Membership and role writes remain function escapes under this
   RFC's D7 in every arm
   and are recorded as function-profile evidence; ephemeral state uses the
   same canonical ephemeral surface symmetrically in every Snapback lane and
   is not tiny-path evidence. With no admitted membership-read profile, Chat
   stays out of the tiny minimum set and no promotion claim covers
   collaborative workloads.
3. **Day-two evolution** — begin from a completed ordinary app, then add one
   multi-row invariant, one role transition, and one external effect so the
   abstraction cliff is measured rather than discussed.

Each lane records:

- monotonic active time to first local read, first authoritative write, first
  proven live transition, first durable offline settlement, first green proof,
  and full acceptance;
- model tokens and tool calls;
- authored semantic facts, generated facts, source volume, and configuration
  volume separately;
- distinct concepts, imports, commands, and files touched;
- documentation/skill retrievals, package-source reads, failed commands,
  correction loops, and interventions;
- permission, bound, lifecycle, and settlement mistakes;
- number and reason of function escapes;
- whether the day-two change preserves data/client identity or causes a
  rewrite; and
- correctness, evidence confidence, capability gaps, and maintenance cost.

Scaffold/skill-assisted and bare lanes are labeled separately under LLP 0197.
Every internal lane receives symmetric knowledge placement. The InstantDB arm
may use Instant's official current skill/scaffold/MCP posture, but that aid and
its target differences are disclosed and do not determine Snapback promotion.

Before the first run, the experiment freezes promotion thresholds. At minimum:

- no new correctness, authority, offline-settlement, or evidence-confidence
  regression relative to the equal-proof control;
- a material reduction in first-green and completion cost on Todo, and on
  Chat when its lane is admitted, not merely fewer lines;
- the day-two workload reaches acceptance through a bounded function escape
  without data migration or client-ownership rewrite; and
- the layer adds no second runtime, cache, outbox, or policy evaluator.

The numeric effect-size threshold and replication count are owned by the
evaluation Plan and must be preregistered before results are visible.

### D10. Promotion is evidence-gated and withdrawal is complete

The tiny surface begins `Experimental` in capability metadata and documentation.
It does not become the default merely because its Todo example is attractive.

After the D9 evaluation, an author decision chooses one of:

1. **promote** — make the tiny path the recommended ordinary-data doorway
   (never while LLP 0252's familiar client aliases remain undisposed
   Experimental: the teach-one-doorway decision composes both experiments'
   recorded results in one author ruling);
2. **continue** — retain it as an experimental or workload-specific option;
3. **revise** — keep the hypothesis but replace a measured weak component;
4. **fold** — absorb only successful pieces into the familiar or explicit
   surface; or
5. **withdraw** — remove the generated projection and public entrypoints.

If the D9 clock ends with no recorded ruling, the default disposition is
automatic: the surface freezes as `Experimental`, no doorway or default
changes, and a backstop ticket files for the author — a missing ruling is
never an implicit `continue`.

Withdrawal leaves canonical schema, policies, functions, data, runtime,
transport, and client lifecycle owners intact. A tiny-surface application can
be projected to generated named operations and its selected function profile
without storage migration. Accepted queued intents drain under LLP 0241: each
keeps its original generation identity and compatible executable until
settlement or its typed stale-generation disposition — the projection never
rewrites a queued record — and Phase 0's withdrawal proof includes this drain
protocol. If that projection cannot be produced mechanically
and reviewed before the experiment ships externally, the experiment is too
entangled to begin.

### Author disposition — withdraw (2026-08-15)

Charlie Cheever selected D10 outcome **withdraw** on 2026-08-15. The Tiny
doorway did not demonstrate enough value to justify a third ordinary-data
conceptual path, and no users require compatibility. The repository therefore
removes `.data(...)`, the generated resource/query/transaction projections,
their public package entrypoints, and their guide path before the next
qualified publication.

The timed D9 matrix ends without a promotion claim. Its preregistration,
publication receipt, diaries, reviews, and research conclusions remain as
historical evidence. Independently used canonical schema, Explicit/Familiar
functions, generated mutation IR, outbox settlement, client lifecycle, and
runtime machinery remain under their own governing LLPs; Tiny-only extensions
and amendments do not.

### D11. Integration with LLP 0252/0253 is explicit, not presumed

This RFC does not silently amend the in-flight familiar profile:

- LLP 0252's one-profile-per-application rule and no-runtime-branch rule remain
  unchanged. Tiny data descriptors are generated capability artifacts, not
  familiar or explicit function source.
- LLP 0253's current Appendix A marks authored `standardPattern` function facts
  unsupported in the familiar grammar and does not list the illustrative
  `.data(...)` table-builder method. Until a reviewed amendment or successor
  disposition admits `DataResourceV1`, familiar generation must refuse that
  unknown method rather than treating this Draft as implementation authority.
- If admitted, `.data(...)` belongs to the schema/table vocabulary shared by
  both profiles. Its generated operations enter canonical artifacts directly;
  they are not smuggled through LLP 0253's familiar function-module grammar or
  its unsupported `standardPattern` source key.
- LLP 0253's free `useQuery(api.ref, args)` alias and this RFC's illustrative
  `db.useQuery(descriptor)` are distinct experimental call shapes. The default
  first-hour path must teach one. The D9 experiment records confusion and
  correction loops caused by their coexistence; promotion may require
  withdrawing or demoting one rather than publishing two equal doorways.
- D9 is a coordinated companion to LLP 0252 D7: shared capsule discipline,
  aid symmetry, LLP 0197 replication and no-pooling rules, and proof bar;
  its own clock, cell table, and D10 dispositions; InstantDB as external
  calibration only. The two matrices stay qualitatively comparable through
  the shared capsule, aid, replication, and proof-bar rules, and any change
  to the default ordinary-data doorway is one author decision over both
  experiments' recorded results.

Acceptance of this RFC therefore authorizes a direction and an experiment, not
an automatic expansion of the 0253 adapter. The follow-on Spec must enumerate
every 0252/0253 disposition it preserves, amends, or leaves unsupported.

## Required canonical artifacts

A follow-on Spec may rename these, but it must provide equivalent versioned
facts. Each artifact is layered: a profile-neutral **normalized core**
carrying the semantic facts, with a named equivalence witness
(`normalizedDataResourceId`, `normalizedDataQueryId`,
`normalizedDataTransactionId`), inside a generation-bound envelope carrying
the app, generation, and profile-bearing identity fences LLP 0241/0252
require. Cross-profile equality is defined over normalized cores and their
witnesses only; envelopes remain distinct and replay-stable, and queued
records keep their original generation identity (LLP 0241).

### `DataResourceV1`

- table and schema identity;
- visibility/authority policy identity;
- eligible read and write operations;
- public argument and result contracts;
- server-owned/defaulted and immutable fields;
- indexes, orderings, cursors, and work ceilings;
- authority-creating/ineligible classification;
- live/local/retained/offline capability facts;
- prediction profile and custody capability (settlement obligatory per D5);
- refusal vocabulary and guide anchor; and
- semantic, executable, evidence, and generation identity inputs.

### `DataQueryV1`

- active app/generation and data-surface version;
- resource and policy identities;
- closed plan shape with values separated from plan identity;
- canonical filters, projection, order, bound, and cursor;
- authority partition and generation;
- required target capabilities;
- result contract and materialization identity; and
- inspector/explain projection.

### `DataTransactionV1`

- active app/generation and data-surface version;
- stable intent and generated operation identities;
- canonical arguments and batch/atomicity facts;
- authority and policy dependencies;
- declared reach and server plan;
- prediction profile and provisional-id reconciliation;
- custody/queue/settlement capability;
- refusal/result contract; and
- conformance/evidence identity.

All three are generated from one canonical owner or covered by a field-complete
parity gate. A new canonical field absent from the data-surface disposition
table fails generation rather than disappearing from these projections.

## Implementation sequence

### Phase 0 — paper surface and causal protocol

- Freeze the concept-count method, the D9 cell table, aids, thresholds, and
  run capsule additions.
- Pin a dated InstantDB surface/aid inventory for the calibration arm (the
  LLP 0252 Phase 0 item 5 pattern).
- Write the follow-on API/descriptor Spec and adversarial security review.
- Produce side-by-side Todo and Chat source projections without runtime code.
- Prove withdrawal can project every tiny declaration into canonical named
  operations and the selected function profile.

### Phase 1 — generated-resource compression

- Build `DataResourceV1` over the existing LLP 0065 standard-pattern owner
  profile and LLP 0231 mandatory table policy.
- Generate stable list/get/create/update/delete refs, validators, results,
  reach, defaults, clients, and proof fixtures from one declaration.
- Add promotion scaffolds and semantic-diff output.
- Run the Todo comparison before adding dynamic client query syntax. This
  isolates declaration compression from query-language work.

### Phase 2 — bounded data queries

- Add `DataQueryV1`, generated builders, server admission, canonical plan
  hashing, policy composition, target capability checks, and explain output.
- Start with one-resource indexed queries and cursor pages; add LLP 0242 nodes
  only when their existing capability proofs compose exactly.
- Bind materialization and retention to LLP 0155/0166/0243 rather than adding
  a new cache. Retained/offline capability for generated queries is
  LLP 0065's disclaimed future profile (its OQ5): the Spec names that
  admission and its LLP 0053 lease and convergence-fixture obligations
  before any generated query claims retention.

### Phase 3 — generated transactions and local prediction

- Add `DataTransactionV1` for eligible generated operations.
- Derive local prediction from the same operation IR and connect it to the
  existing outbox/settlement owners.
- Prove crash/reopen, duplicate-free settlement, refusal reconciliation,
  logout/user-switch purge, and negative authorization changes in real stores.

### Phase 4 — ordinary clients and evaluation

- Add the profile-neutral `db` projection to React/headless first, then Expo and
  Swift from the same descriptor fixtures.
- Ship the exact experimental package closure and symmetric guide/skill
  path; the first qualified publication of that closure starts the D9
  clock.
- Run D9, publish raw records, and request the D10 author decision.

Each phase is separately withdrawable. Later phases cannot be used to relabel
an earlier incomplete result as a passed tiny-surface experiment.

## Acceptance

### Semantic and security acceptance

- A table without explicit visibility/public policy cannot generate a data
  resource.
- Omitting a client filter can never omit or weaken policy; policy is composed
  from the active canonical IR on every read and write.
- A generated query without an admitted index, total order, or finite bound
  refuses before reading data.
- A client-edited descriptor cannot expand the generated resource, policy,
  result, reach, capability, or work ceiling.
- Authority-creating and permission-backing tables cannot receive generic data
  writes.
- Server-owned fields are absent from public write arguments and are derived in
  the authoritative transaction.
- Unsupported query and transaction shapes fail with stable diagnostics and a
  specific function escape; there is no scan, polling, admin, or post-filter
  fallback.

### Local-first and lifecycle acceptance

- One canonical query state carries live, offline, retained, blocked,
  refreshing, and error distinctions without a second cache.
- A generated eligible write paints optimistically, survives a real
  crash/reopen when custody is accepted offline, settles exactly once after
  reconnect, and converges in an independent observer.
- The API never reports queued custody as authoritative settlement.
- Logout, user switch, expiry, membership loss, and policy change satisfy the
  existing purge/resnapshot/invalidation obligations.
- An operation without generated prediction can still be accepted into
  durable custody and queue offline with `withheld`/`unavailable`
  presentation when its custody contract permits, and settles exactly once;
  prediction and custody capabilities are declared independently, and
  settlement obligations are tested independently — settlement itself is
  never a declarable toggle (D5).
- A non-predictable or non-retainable operation remains usable only with its
  accurately declared capability; no convenience alias upgrades the claim.

### Architecture and withdrawal acceptance

- Explicit and familiar applications generate byte-equivalent normalized
  cores — equal `normalizedDataResourceId`/`normalizedDataQueryId`/
  `normalizedDataTransactionId` witnesses — for semantically equal inputs,
  apart from named source-custody exclusions; the enclosing generation
  envelopes remain distinct per the LLP 0241/0252 identity fences.
- Production runtime/client behavior does not branch on function-authoring
  profile after admission.
- The tiny client owns no transport, cache, auth coordinator, outbox,
  settlement registry, policy evaluator, or diagnostics type.
- Every public tiny-surface fact is generated or parity-gated from a canonical
  owner.
- Withdrawal projects an experimental app to supported canonical operations
  without data migration or loss of accepted queued intents.

### Authoring and evaluation acceptance

- A cold Todo builder reaches full proof using only the four ordinary concepts
  and performs no package-source read.
- The Chat arm, when admitted under D9's staging, completes policy, live,
  offline, pagination, and ephemeral acceptance without application-authored
  repository, cache, invalidation, optimistic reducer, or outbox code.
- The day-two arm escapes to one selected function profile without rewriting
  storage or client ownership.
- Raw timing, tokens, semantic actions, corrections, source/config/generated
  volume, aids, gaps, and evidence confidence are published before any summary
  score.
- The preregistered D9 promotion thresholds are evaluated without post-result
  edits.

## Risks

### Hidden magic rather than genuine smallness

Codegen can hide decisions while leaving authors unable to predict behavior.
The defense is explicit policy, printed normalized resources/plans, semantic
diffs, explain output, generated contracts, and a count of independent choices
rather than source lines.

### A severe abstraction cliff

Todo may be exceptionally small while the first invariant forces a new backend,
client rewrite, or loss of offline behavior. The day-two workload and promotion
protocol are acceptance requirements, not follow-up polish.

### Query-language scope becomes a second database

An unconstrained client query grammar could reproduce a large ORM, create
unbounded work, or diverge across targets. V1 stays within the admitted bounded
node algebra, and new operators belong to their owning query RFCs rather than
arriving as frontend sugar.

### Direct-looking writes weaken authority

`db.tx.todos.update(...)` may look like a raw client write even though it is a
generated server-authoritative operation. Documentation, types, descriptors,
and inspection must consistently call it an intent, keep server-owned fields
absent, and refuse authority-bearing tables.

### Truthful state makes the result look larger

A five-field query state is visually larger than `Result | undefined`, and a
settlement handle is larger than a promise. Collapsing those facts would trade
surface size for bugs. The experiment should measure whether one stable state
object is learnable, not assume every semantic distinction must be a separate
hook.

### Two public doorways become permanent

The tiny path and the familiar function path could create more total surface
rather than less. D1, D8, and D10 require one generated data layer, one function
profile per app, one client core, and a withdrawal projection. Promotion should
also demote the explicit low-level data path from first-hour documentation,
not advertise all doorways equally.

### Templates and skills confound the result

InstantDB and Snapback both invest in agent context. D9 requires symmetric aids,
separate bare/template labels, and same-runtime internal controls so a good
starter is not mistaken for an intrinsically smaller API.

## Open questions

1. **Exact query spelling:** object query, fluent builder, or both as one
   canonical grammar? Two spellings may undermine the concept budget even if
   they lower identically.
2. **Descriptor construction:** should query shape be admitted wholly at
   runtime, statically extracted when possible, or statically suggested and
   frozen into a named view? Security must not depend on extraction.
3. **Implicit bounds:** should `.take(...)` be mandatory, or may a resource
   declare one visible default? A default is smaller but easier to mistake for
   completeness.
4. **Transaction result:** what is the smallest grammar that exposes immediate
   prediction, accepted custody, queued state, and authoritative settlement
   without requiring separate application bookkeeping?
5. **Atomic composition:** how many generated chunks may one v1 transaction
   contain, and which link/unlink or cross-resource operations are eligible?
6. **Promotion identity:** which generated operations can become custom
   functions without changing their public reference, and which contract
   changes require an explicitly new operation?
7. **System fields:** should identity, owner, and creation time remain explicit
   schema fields, or can a data-resource profile generate them without making
   security intent harder to review?
8. **Policy profiles:** after owner, which of public, membership, role, and
   field-masked resources are sound enough for generic reads and writes?
9. **Relationships:** what is the smallest admitted relationship syntax that
   preserves bounds, pagination, policy composition, and local custody?
10. **Non-TypeScript clients:** how closely should Swift and future clients
    mirror the JS builder versus exposing language-native projections of the
    same descriptors?
11. **Package relationship:** if LLP 0253's `@expo/snapback` umbrella is
    withdrawn, which existing package owns the tiny doorway without adding a
    new top-level package?
12. **Evaluation size:** what replication count and preregistered effect size
    are large enough to choose a default despite the substantial variance seen
    in prior authoring runs?

## Status

Accepted (2026-08-13, author-directed, after the three-family super-refine
loop converged on r3 and the commissioned r3→r4 delta review returned the
GPT family READY on r4 — run journal:
`llp/reviews/0254-tiny-ordinary-data-surface.run.md`). This RFC preserves a
product hypothesis and defines the boundary of a same-runtime experiment.
Acceptance authorizes the direction and the experiment (D11); it does not
authorize a public API, a third authoring profile, arbitrary client queries,
raw client writes, or a change to the default Snapback authoring path. The
follow-on Spec and preregistered evaluation Plan remain required before
implementation claims or promotion.
