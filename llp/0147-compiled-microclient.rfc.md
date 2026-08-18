# LLP 0147: Ahead-of-time compiled microclient

**Type:** RFC
**Status:** Accepted
**Systems:** Client SDK, Client integration, Packaging, Code generation,
Wire Protocol, Realtime, Auth, React/Expo, Developer experience, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-01
**Revised:** 2026-08-01 (v0.1, initial successor RFC to LLP 0145; the additive
Full/Micro profile contract and the compiled safe surface over a minimal
generic transport)
**Revised:** 2026-08-01 (v0.2, round-1 super-refine corrections — both families
NOT READY. Headline: D4's settled-replay carve-out and the decision that Micro
v1 carries no `clientMutationId`; D3's egress boundary renamed
client-publication egress with its universality claim narrowed to what the code
does, after the live-delta seam was found unvalidated and ticketed.)
**Revised:** 2026-08-01 (v0.3, round-2 super-refine corrections — both families
NOT READY on defects v0.2 itself introduced. Headline: D4's "no conflict to
adjudicate" claim withdrawn as false and a dated LLP 0012 clarification
commissioned; gate 11a made fix-neutral; gate 15a reconciled with LLP 0095's
tolerance floor; retry policy restated as kind-derived.)
**Revised:** 2026-08-01 (v0.4, round-3 super-refine corrections — Fable READY,
Codex NOT READY, both converging on one v0.3 defect: D6 called a confirmed
commit "indeterminate." Superseded in part by v0.5.)
**Revised:** 2026-08-01 (v0.5, round-4 super-refine corrections — Fable READY,
Codex NOT READY on a blocking factual defect v0.4 introduced. v0.4 had inverted
D6 to *publish* a late-generation success, on the premise that a deployment
could rotate between a mutation's commit and its response-facts read. That
interleaving is forbidden by LLP 0058's sessions activation barrier. Superseded
in part by v0.6.)
**Revised:** 2026-08-01 (v0.6, round-5 super-refine corrections — Fable READY
with one MATERIAL, Codex NOT READY, converging on the same defect at different
severities: v0.5's repair was true but stated **universally**. Two conforming
exceptions exist and v0.6 scopes to them. First, a settlement replay is a
conforming sessions success whose facts may legitimately differ, since LLP
0043's lookup precedes generation comparison — unreachable for this profile,
which emits no `clientMutationId`, so D6 is now explicitly scoped to fresh
admissions and gate 12 re-scopes D6's classification alongside itself for any
settlement-adopting composition. Second, the deployment-refusal window does not
end only at regeneration: generation identity is content-derived, so an operator
rollback re-activating the byte-identical predecessor also ends it. D6 also now
makes the one fresh subscribe LLP 0095's `resync_required` transition requires
before stopping, and names `SNAPBACK_UNKNOWN_FUNCTION` as the removed-function
channel. §Runtime contract now **requires** the sessions fact rather than
comparing it if present, per LLP 0012, with gate 12's defensive fixture
covering absent as well as unequal facts. Duplicated no-overtake prose
collapsed to a cross-reference. Per-round detail in
`reviews/0147-compiled-microclient.super-refine.md`.)
**Revised:** 2026-08-01 (v0.7, round-6 close-out — **dual-family READY on
v0.6**, the loop's converged revision. Status promoted Draft → Review under the
`/llp-super-refine` authorization, which permits that transition and no further.
Both families returned one DETAIL each, applied here without re-review as both
explicitly recommended: the Cloudflare exclusion restated as "no checked-in
target advertises both contract capabilities," because the all-aboard manifest
also advertises `bounded_response_stream_v1` and `cron` and "nothing else" was
literally false; D6's first bullet given a named pointer instead of a wrong
positional one; and the rollback exit attributed to codegen's deterministic
regeneration of the asserted identity fields rather than to "content-derived"
identity, which blurred LLP 0058's distinction between deterministic derivation
and receiver-computed content-address proof. Acceptance obligations both
families named: land D4's dated LLP 0012 fresh-admission clarification together
with the `crates/snapback/src/manifest.rs` mutation-envelope comment correction, and D3's dated
LLP 0114 Micro-projection amendment. Loop record in
`reviews/0147-compiled-microclient.super-refine.md`.)
**Revised:** 2026-08-02 (ACCEPTED by Charlie Cheever in the 2026-08-02
decision sitting — see `issues/20260802-author-decision-packet.md`. The
precondition defect this loop found (live delta frames bypassing
result-contract validation) was fixed on main as eda8f231 before
acceptance. Per §Ratification, acceptance authorizes the additive Micro
profile and the server-egress trust boundary only: no default change, no
carrier claim, no met-size-target claim. Phases A–B may begin, with the
stop-after-Phase-B rule in force.)
**Revised:** 2026-08-02 (v0.8, Phases A–B implementation record — the
local-dev core, generated surface, immutable supplemental size ledger, and
paired operational receipt landed. Gate 11a's server-egress premise is green.
The Phase-B stop rule did not trigger; a separately authorized Phase C is
ready to be commissioned. This records no sessions composition, capability
class, carrier, React, or publication claim.)
**Related:** LLP 0000, LLP 0010, LLP 0012, LLP 0041, LLP 0043, LLP 0053,
LLP 0058, LLP 0059, LLP 0063, LLP 0064, LLP 0077, LLP 0090, LLP 0093, LLP 0094,
LLP 0095, LLP 0096, LLP 0108, LLP 0112, LLP 0114, LLP 0115, LLP 0122,
LLP 0127, LLP 0129, LLP 0131, LLP 0133, LLP 0144, LLP 0145

## Summary

Snapback will add an ahead-of-time compiled **Micro** client profile beside
the existing compatibility client. The current client remains the **Full**
profile and keeps its existing behavior and imports. The Micro profile is an
additive, generated application surface under a new `./micro` package
subpath; it is not a narrowing of the already-published `./online` subpath.

The central design is an intentionally asymmetric trust split:

- application code sees exact generated functions with precise argument and
  result types;
- code generation checks the selected operations, contracts, target posture,
  protocol lanes, and static module closure before the application builds;
- the browser runtime reduces each operation to a compact descriptor plus a
  deliberately generic invocation primitive;
- the server remains authoritative and validates credentials, authorization,
  arguments, the active generated artifact generation, handler behavior, and
  results at the runtime boundaries that matter; and
- the client retains only the distributed-systems mechanisms that cannot be
  proved away before execution: transport, cancellation, structured errors,
  live ordering, authority fencing, explicit release, and honest ambiguous
  outcomes.

The generic primitive is “unsafe” only in the authoring/API sense: by itself it
accepts opaque JSON and returns opaque JSON. It is not a security authority and
the server never trusts it. It is an implementation seam for generated code,
not the paved application API. Generated wrappers and the server's existing
ingress/egress checks make ordinary use typed and fail-closed in practice.

The first spike targets query, mutation, action, and one live collection in
local-dev posture, claims no carrier or capability class, and establishes the
JavaScript byte floor. The next measured composition adds caller-custodied
sessions. Product graduation requires the sessions composition, because that
is where the already-shipped per-call `expectedGeneration` assertion is
atomically enforced before effects. Hosted-browser and first-party credential
custody remain later compositions with their mandatory auth machinery; the
Micro name never implies that those costs or obligations disappear.

The target inherited from LLP 0145 is at most **20 kB gzip for the headless
runtime and 25 kB including the generated application entry** for the first
spike. Size is necessary and not sufficient: the profile does not graduate
unless the same artifact passes its routed protocol, authorization, lifecycle,
and whole-application acceptance gates.

## Status and authority

This is the successor RFC commissioned by [LLP 0145](./0145-client-bundle-architecture.research.md)
§D-D. LLP 0145 remains the evidence and option-analysis authority; this RFC
owns the proposed profile contract, compiler/runtime boundary, static module
composition, safety claims, and rollout. [LLP 0041](./0041-packaged-dev-loop.rfc.md)
continues to own package publication and distribution mechanics.

Nothing in this proposal changes the current default. In particular:

- `SnapbackClient`, the package root, and the existing `./online` export keep
  their current semantics;
- the browser default remains persistence-preferred with its reported memory
  fallback under [LLP 0129](./0129-local-first-program.plan.md);
- no new `Online`, `Parity`, browser, iOS, or Android capability claim is made;
- no auth lane is weakened or omitted for a posture that requires it; and
- the first spike produces unqualified experimental evidence, as LLP 0145 D-C
  already decides.

Acceptance of this RFC would decide the architecture. A follow-on Plan should
own work ordering, implementer assignments, and phase state. The implementation
sequence below fixes dependencies and gates so that Plan cannot silently change
the contract.

## Motivation

LLP 0145 measured the ordinary `SnapbackClient` closure at 70.1 kB gzip and
found that a simple import reaches most of the client platform: online calls,
live transport, React admission, authorization invalidation, sender proof,
retained state, offline replay, RQS stores, result validation, and generic
manifest interpretation. Packaging repairs help, but cannot make one class
tree-shake behavior it owns unconditionally.

At the same time, Snapback already performs most application-specific proof
outside the browser:

- codegen emits exact function references and exact `Args`/`Result` types;
- [LLP 0131](./0131-structured-argument-contracts.spec.md) validates fresh
  invocation arguments server-side before handler dispatch or effects;
- [LLP 0108](./0108-inline-handlers-and-result-contracts.spec.md) requires
  results validated server-side before query/live publication, before mutation
  commit, and before action-result publication — honored on the snapshot and
  re-run paths, with one shipped delta-lane exception D3 records and gates;
- generated references carry operation, implementation, argument-contract,
  and result-contract hashes;
- generated references now also carry the complete `expectedGeneration`
  object, and [LLP 0012](./0012-headless-integration-contract.spec.md)
  §Call-time generation binding repeats it on query, mutation, action,
  authorized-lease, and live-subscribe requests; and
- sessions-mode server dispatch selects the function and compares that
  generation with the active schema/function pair as one admitted operation,
  refusing before handler, acknowledgement, receipt, or mutation effects — for
  every *fresh* admission. Recovery of an already-committed LLP 0043 settlement
  is the one carve-out; D4 states it.

That last mechanism landed after the research snapshot that left exact
operation identity as LLP 0145 OQ20. This RFC adopts the landed per-invocation
generation tuple; it does not introduce the new expected-operation protocol
that LLP 0108 deliberately removed from its first implementation slice.

The opportunity is therefore not “delete validation and hope TypeScript is
right.” It is to stop shipping generic browser machinery for facts already
proved by codegen or enforced by the authoritative server, while preserving
the runtime mechanisms whose correctness depends on future events.

## Vocabulary

### Full and Micro are packaging profiles

**Full** and **Micro** name package/runtime compositions. They are not the
`Online` and `Parity` capability classes defined by LLP 0012 and LLP 0064.

- **Full** means the compatibility composition currently reached by
  `SnapbackClient`. It may include retained state, offline queues, RQS,
  optimistic settlement, first-party auth custody, sender proof, and other
  advanced facilities.
- **Micro** means the generated, active-memory, conservative composition in
  this RFC. It speaks only the operation and auth lanes selected by its
  generated profile and makes the explicit nonclaims below.

A Micro artifact may later earn a capability-class receipt. Packaging alone
never grants one.

### Compiled-safe surface

The **compiled-safe surface** is the generated TypeScript/JavaScript entry that
application code imports. It contains exact named wrappers, exact types, and
compact immutable descriptors derived from one admitted application artifact
generation.

“Safe” here means:

1. ordinary typed application code cannot call an unselected operation or pass
   an argument outside its generated type without a type error;
2. the build refuses a selected operation whose required contract or runtime
   capability is absent;
3. a sessions deployment refuses a stale generated artifact atomically before
   an operation effect; and
4. the authoritative server validates inputs, authorization, and outputs even
   when a malicious or untyped caller bypasses the generated surface.

It does not mean TypeScript is a security boundary or that arbitrary JavaScript
cannot use `as any`, raw `fetch`, or a handcrafted request.

### Unchecked transport core

The **unchecked transport core** is a small internal seam equivalent to:

```ts
invoke(descriptor, jsonArguments): Promise<unknown>
subscribe(descriptor, jsonArguments, observer): SubscriptionHandle
```

It knows protocol envelopes and the minimum lifecycle state machine. It does
not interpret the application schema, import handler source, discover
operations dynamically, or pretend its opaque JSON is typed. The package may
expose a clearly internal implementation subpath so generated packages can
link it, but templates, guides, and application declarations never import it
directly. Its TypeScript result is `unknown`; generated code is the only
first-party layer allowed to project that value to a precise operation result.

The server treats calls through this seam exactly like calls from any hostile
client. Hiding the seam is an authoring boundary, not an authorization control.

## Decisions

### D1. Additive `full` and `micro` profiles

The current package root and `./online` remain compatibility surfaces. The new
profile is published under `@expo/snapback-client/micro` (with the normal
registry aliasing owned by LLP 0041). Generated applications import their own
entry, which in turn imports that subpath.

`./online` is not repurposed: it already exports the full-semantics
`SnapbackClient`, and narrowing it would be a breaking change disguised as an
additive profile. A future major version may revisit the default only after
real applications prove Micro covers the paved road and LLP 0129 is amended.

The Full profile remains one correctness implementation during the Micro
spike. This RFC does not require immediately refactoring Full into the same
modules; shared primitives are extracted only where doing so keeps the Micro
closure inside its budget and the conformance behavior identical.

### D2. Ahead-of-time specialize the application API

Codegen emits one Micro entry per declared client profile. The logical input is
a closed, inspectable selection containing:

- profile name and `micro.v1` format;
- selected operation names;
- target arm and delivery lane;
- auth posture and exact auth profile set;
- carrier/OS tuple, if any is claimed later;
- custody owner;
- selected optional client facilities; and
- explicit nonclaims.

The physical authoring syntax is a codegen concern, but it must remain source
controlled and deterministic. Runtime discovery, application bundle scanning,
and “include whatever happened to be imported” are not sources of profile
authority. A build tool may use an import graph to report dead generated
wrappers, but it does not silently change the declared semantics.

For each selected operation, codegen requires:

- one known generated operation reference;
- a kind in `Query | LiveQuery | Mutation | Action`;
- a complete structured argument contract under LLP 0131;
- a concrete result contract under LLP 0108, not `Unknown`, for the typed
  paved road;
- stable operation, implementation, argument-contract, and result-contract
  identity; and
- one complete `expectedGeneration` shared by the generated artifact pair.

An operation with an unknown result may be omitted or emitted only through an
explicit degraded entry returning `unknown`; it never receives a fabricated
precise type. The default Micro generation command refuses degraded selected
operations.

The emitted runtime module contains no argument JSON Schema, result-contract
descriptor, full function manifest, capability manifest, schema manifest,
handler source, source map, dependency path, or generic function registry.
Those remain build/server artifacts. The module contains only values used at
runtime: endpoint/profile configuration, one shared generation tuple, compact
operation descriptors, selected protocol constants, and wrappers.

Conceptually, the generated runtime and declaration pair looks like:

```ts
import { createMicroRuntime } from "@expo/snapback-client/micro";

const generation = Object.freeze({
  schemaVersion: "snapback.v1",
  appId: "todos",
  schemaHash: "sha256:…",
  bundleHash: "sha256:…",
  inputsHash: "sha256:…",
});

const runtime = createMicroRuntime({ endpoint, generation, profile });
const list = Object.freeze({ kind: "Query", name: "todos.list" });
const rename = Object.freeze({ kind: "Mutation", name: "todos.rename" });

export const listTodos = (args) => runtime.invoke(list, args);
export const renameTodo = (args) => runtime.invoke(rename, args);
```

```ts
// Paired generated .d.mts; never authored by the application.
import type { Id } from "./schema.js";

export function listTodos(args: { done?: boolean }):
  Promise<readonly Todo[]>;
export function renameTodo(args: { id: Id<"todos">; title: string }):
  Promise<void>;
```

This example is explanatory, not a frozen emitted spelling. The normative
properties are one shared generation tuple, exact generated wrappers, compact
descriptors, no generic application manifests in the closure, and a runtime
whose raw result is not independently application-typed.

### D3. Put application validation on authoritative boundaries

The Micro profile does not ship a generic application-value validator.
Instead, it relies on three distinct boundaries and does not conflate them:

| Boundary | Owner | Required behavior |
| --- | --- | --- |
| Authoring | codegen + TypeScript | derive exact wrapper types; refuse missing/unsupported contracts and capabilities |
| Invocation ingress | server, LLP 0131 | validate actual JSON arguments before handler dispatch, plan execution, or effects |
| Client-publication egress | server, LLP 0108 | validate actual result JSON before *any* client-bound publication — snapshot, replacement, delta, mutation commit, or action result |

The third boundary is deliberately named for the publication, not the handler.
An application value can reach a subscriber without ever being a handler return
value, and the seam has to cover that or the decision below is unsound.

**The seam is not yet universal, and this RFC does not pretend otherwise.**
LLP 0108 requires that "query and live-query output is validated before
snapshot/live publication, cache insertion, or transport serialization," and
the local server honors it on the snapshot and full-re-run paths. It does not
honor it on the live *delta* path, which copies committed storage rows into the
wire frame with no result-contract validation, so a result contract narrower
than the table schema can be violated by a delta after a valid snapshot. That
is a shipped defect against LLP 0108, not a Micro design choice; it is filed as
`issues/20260801-live-delta-frames-bypass-result-contract-validation.md` and
gated below. **Closing it is a precondition of D3, not a follow-on**: until the
delta lane validates — or refuses in favor of a validated replacement — a Micro
profile selecting live queries may not claim the server-trust property, and
gate 11a is the graduation blocker that enforces this.

The Micro runtime still validates the Snapback protocol envelope: HTTP status,
diagnostic shape, operation-kind response envelope, version/cursor fields,
well-formed live-frame discriminants — an absent or non-string `kind` is
malformed, while a valid unknown string kind is skipped and never fatal per LLP
0095's tolerance floor — and bounded JSON decoding. This list is the v1 floor
and is decided; OQ8 asks only whether a later revision may narrow it, never
whether v1 may ship with less. The runtime does not recursively revalidate
application payload fields already validated by the authoritative server.

This is an explicit server-trust decision. A compromised or incorrect server
can violate the application result contract; the client does not defend
against its own authoritative backend with a duplicate generic validator.
TLS/origin integrity and server qualification remain deployment concerns. A
third-party backend impersonating Snapback is outside the profile's trust
claim.

The choice removes neither security nor runtime truth:

- a caller bypassing TypeScript still reaches server ingress validation;
- a handler returning malformed data is refused before the server releases it;
- a mutation result-contract failure rolls back its storage transaction;
- an action's prior external effects remain irreversible, exactly as LLP 0108
  already states, and only its result publication can be refused; and
- operations whose server target does not advertise the required argument and
  result contract capabilities refuse profile admission rather than silently
  skipping checks. That refusal is a real generation failure with a negative
  fixture, not an assumption: §Compile and generation failures names the family
  and gate 7a proves it. It is the second independent reason every checked-in
  Cloudflare target is out of scope: none advertises both `args_contract_v1` and
  `result_contract_v1`, so none could admit a Micro profile even with sessions.

On acceptance, this decision requires a dated Micro-projection amendment to
LLP 0114: “runtime egress is validated before typed publication” is satisfied
by the server egress seam plus Micro envelope validation; the Micro React
binding does not repeat the generic application-payload validation performed
by the Full admission path. Full behavior is unchanged.

### D4. Reuse call-time `expectedGeneration`; do not invent an operation wire id

The Micro profile uses the `expectedGeneration` carrier already specified and
implemented under LLP 0012. Every generated query, authorized-lease query,
mutation, action, and live subscribe repeats the complete tuple. In sessions
mode, for every **fresh** admission the server must:

1. resolve the operation under the request's authenticated authority;
2. select the active schema/function pair for that same invocation;
3. compare the expected and active generation before argument evaluation,
   handler execution, acknowledgement, receipt creation, or mutation effects;
4. refuse mismatch as `SNAPBACK_ARTIFACT_IDENTITY_MISMATCH` with
   `subcause: "generation"`; and
5. return only server-derived `facts.activeGeneration` on success.

**The settled-replay carve-out.** "Fresh admission" is load-bearing. The
shipped mutation route consults the client-mutation settlement cache before it
selects a function, and on a hit it re-releases the original committed output
and records a receipt without comparing generations at all. That is deliberate
and it is correct: the effect already happened under the generation that was
active when it happened, the path dispatches no handler and produces no new
effect, and refusing the replay would strand a durable settlement and
manufacture ambiguity where none exists.

**There is a live specification conflict here, and this RFC does not paper over
it.** LLP 0043 states the shipped ordering — "before selecting an active
mutation function, the server … looks up the exact `(clientMutationId,
function, input, auth fingerprint, authority instance)` identity. A hit
republishes the stored result without handler dispatch … A miss then uses
ordinary active-function selection." LLP 0108 §B removed its own competing
`ExpectedOperationV1` replay machinery and deferred to that: settlement
"identity, lookup order, acknowledgement, retention, replay, and garbage
collection remain exactly as governed by LLP 0043." But LLP 0012 §Call-time
generation binding still states its rule unconditionally — an unequal asserted
pair "refuses before handler, acknowledgement, receipt, or mutation effects" —
with no settlement carve-out. LLP 0012 is the document that disagrees with both
LLP 0043 and the implementation.

Acceptance of this RFC therefore requires a dated clarification to LLP 0012
scoping its call-time generation rule to **fresh admission**, preserving LLP
0043's settlement-first lookup, and stating what a replay returns for
generation facts and for a removed function (LLP 0043 already answers the
latter: `SNAPBACK_UNKNOWN_FUNCTION` after authenticated ACK GC). The same
landing corrects the mutation-envelope source comment that restates LLP 0012's
unconditional ordering, so the normative fix does not leave an
implementation-facing explanation false. That is the
same commissioning pattern D3 uses for LLP 0114. Micro v1 makes the path
unreachable, which is why this is a clarification and not a blocker on the
profile — but leaving LLP 0012 stating a rule the server does not implement
would hand the next reader the same defect this loop found. With that
amendment: LLP 0043 governs settlement recovery, D4 governs fresh admission,
and gate 12 is scoped accordingly.

**Micro v1 mutations carry no `clientMutationId`.** The carve-out is therefore
unreachable from a Micro v1 client, and this is a decision, not an omission:
settlement custody is the durable-outbox/optimistic-replay surface D5 already
disclaims, and D6's ambiguity rule already refuses to retry a non-idempotent
mutation. It also removes the only shipped idempotency mechanism from v1, which
is why §Runtime contract has two retry classes rather than three. A later Micro
composition that wants transport-ambiguity retry must adopt LLP 0043 settlement
semantics — including this carve-out — as a measured addition with its own
byte line and its own fixtures.

This closes the time-of-check/time-of-use gap LLP 0145 identified without a
separate admission lease or immutable deployment URL. The proof is coarser
than a per-operation tuple: an unrelated operation change rotates the complete
bundle generation. V1 accepts that conservative invalidation because it is
already implemented, easy to explain, and safe. A later per-operation identity
carrier needs its own measured RFC; it is not smuggled into this bundle-size
program.

Human operation names remain on the current routes. Compact values in generated
code are client-local constants, not numeric wire identifiers.

Dev mode deliberately tolerates and does not enforce `expectedGeneration`.
Therefore:

- the local-dev spike may prove code size and ordinary behavior;
- it may not claim atomic stale-generated-operation refusal;
- a product Micro profile must repeat the experiment in sessions mode; and
- generated tooling must label local-dev receipts as unqualified rather than
  presenting them as the product safety claim.

### D5. Keep a small static module graph

Micro v1 has these logical modules. Physical files may combine modules when a
bundle receipt proves the combination cheaper without weakening static
selection.

| Module | Included when | Owns |
| --- | --- | --- |
| `core` | always | endpoint, generation, request encoding, cancellation, timeout, structured diagnostic/envelope decoding |
| `operations` | any query/mutation/action | named invocation and operation-kind response projection |
| `live` | any live query | connection grant, socket/poll lane selected by profile, snapshot/delta ordering, gap recovery, resubscribe, unsubscribe |
| `authority-fence` | always | monotone authority capture and final-publication comparison |
| `auth-rr` | sessions posture | `auth/rr` offer grammar on every in-scope request and upgrade |
| `auth-live` | sessions + any live selection | open/subscribe/unsubscribe offer grammar and namespace lifecycle |
| `auth-obligation` | sessions posture + any live selection in Micro v1 | receipt, quarantine, snapshot apply-before-ACK, `terminalDelete`, duplicate re-ACK, foreign-obligation refusal |
| `session-custody` | client owns first-party credentials | refresh/logout, durable custody, cross-context ownership and transition barriers |
| `sender-proof` | hosted sender-constrained browser | LLP 0077 issuance/proof/custody lane; no bearer-only fallback |
| React projection | React build | Micro external store and hooks in `@expo/snapback-react`; no generic Full admission import |

The shared kernel has a separate byte budget and may not become a new monolith.
A capability module can depend on `core` and the exact shared mechanism it
needs; `core` cannot import every capability in order to dispatch by runtime
flag.

The following are absent from Micro v1:

- RQS, retained reads, durable outbox, offline replay, optimistic settlement,
  and local handler execution;
- file-backed, IndexedDB, or generic storage engines;
- ephemeral state, assets, admin, generic inspect/discovery, and query groups;
- the Full React admission path and generic manifest comparison;
- server handlers, source maps, schemas, full function/capability manifests,
  and unselected auth profiles; and
- dynamic import of omitted capabilities.

Those are profile nonclaims, not missing implementations hidden behind runtime
errors. An application needing them selects Full until a separately measured
Micro module is proposed and graduated.

Admin is not a deferred Micro module. LLP 0127 decision 4, recorded in LLP
0115, places application-external admin work in the CLI, with the served path
as the external-tooling fallback.

### D6. Make conservatism the Micro policy

Micro removes complex policy only by choosing a simpler safe behavior:

- reconnect, a version gap, or an accepted authorization snapshot obligation
  blanks affected readable state and takes a fresh snapshot. A *deployment*
  transition blanks but cannot complete a resnapshot while it remains stale; the
  deployment-transition bullet below states why;
- `terminalDelete` destructively retires the exact materialization, installs a
  no-resurrection fence, acknowledges only after destruction, and requires a
  fresh never-reused query identity for recreation;
- ordinary live data applies only versions newer than its held snapshot and
  resnapshots rather than guessing across a gap; an authenticated obligation
  resolution may apply an equal data version only with the exact newer
  authorization witness LLP 0095 requires;
- every normal subscription shutdown/background transition explicitly
  unsubscribes with the establishing live owner; socket loss/idle reap remains
  the crash backstop, not the normal release path;
- an ambiguous non-idempotent mutation or action surfaces a structured
  indeterminate-outcome diagnostic, never a successful typed result, and is
  never retried automatically;
- **for this profile**, a sessions success carries `facts.activeGeneration` and
  it equals the request generation. Absence or inequality is a **protocol
  violation, not a deployment race**: publish nothing, surface a structured
  protocol diagnostic, make no claim about the operation's outcome. The scoping
  is load-bearing and the reason is D4's: every Micro v1 request is a fresh
  admission, because the client emits no `clientMutationId`. A settlement replay
  — which this profile cannot make, and a later composition can — is the one
  conforming success whose facts may legitimately differ, since LLP 0043's
  lookup precedes generation comparison; its facts semantics belong to D4's
  commissioned LLP 0012 clarification, and gate 12 re-scopes both that gate and
  this bullet for any composition adopting settlement. Within the scope, the
  guarantee is LLP 0058's: activation "closes new admission and waits for every
  predecessor finite invocation and retained HTTP response body to drain" before
  publishing the successor, and the server reads facts inside the request's own
  admission, re-validating it first — so a successor cannot publish while a
  predecessor response is still assembling. Real deployment transitions reach a
  fresh-admission client through refusal and through subscription retirement;
- a deployment transition observed that way — `SNAPBACK_ARTIFACT_IDENTITY_MISMATCH`
  on a call, or a retired subscription — blanks affected readable state, makes
  the one fresh subscribe LLP 0095's `resync_required` transition requires,
  and on its refusal raises the stale-artifact signal and **stops**. It does not
  loop: the generated client can only assert its own generation, so resubscribes
  stay refused while a different generation is active. Two things end that
  window — the application loading regenerated successor code, or an operator
  rollback re-activating the byte-identical predecessor, since codegen
  deterministically regenerates the asserted identity fields from the same
  inputs. The stopped client deliberately polls for
  neither. (A removed function surfaces `SNAPBACK_UNKNOWN_FUNCTION` instead,
  because selection precedes generation comparison.);
- actions are supported in the first spike, but their external effects are
  never described as transactionally rolled back by result validation; and
- no stale request, callback, reconnect, subscription establishment, socket
  frame, grant open, store write, success, failure, timeout, abort, or terminal
  auth path may publish after its authority capture ceases to be current.

The `authority-fence` module is irreducible in every posture. Cancellation is
not its substitute: already-scheduled work can complete after an abort. Where
the client owns credentials, LLP 0059's durable cross-context custody and
transition barrier are also irreducible and their bytes count against that
composition.

### D7. Stage auth posture instead of averaging it away

The Micro artifact declares exactly one posture. The required compositions are:

| Stage/posture | Required auth modules | Claim |
| --- | --- | --- |
| First spike: local dev | authority fence only; dev identity seam | unqualified experimental byte/behavior evidence |
| Second spike: sessions, caller custody | authority fence, `auth/rr`, and `auth/live`/obligations when live is selected | candidate Micro product semantics; no first-party custody claim |
| Later: sessions, first-party custody | second-spike set plus session custody and cross-context barrier | only after its own browser/OS receipt |
| Later: hosted sender-constrained browser | applicable sessions set plus sender proof | only against a qualified hosted target and the extended LLP 0077 matrix |

An externally supplied bearer changes custody ownership, not the server's
sessions posture. Such a client still sends `auth/rr`; with live selected it
still sends `auth/live`, and it implements obligations wherever the server may
deliver them.

In sessions mode the client always offers `auth/live` on open, subscribe,
unsubscribe, and the WebSocket upgrade whenever its generated operation set
contains any live function. It does not branch on generated
`authorityIndependent` declarations to omit the carrier or the obligation
module: LLP 0096 makes authority independence a server fact protocol clients
cannot safely use for the carrier decision, and keeping the obligation module
in Micro v1 prevents a stale generated declaration from creating a client that
cannot consume a frame the server correctly sends. The server may choose not
to deliver obligations for an authority-independent subscription; the
carrier and module remain present while delivery stays selective.

The hosted-browser floor remains `auth/rr`, `auth/live` when live is selected,
and `auth/sender`, with no bearer-only fallback. The current Cloudflare arm has
no sessions surface, so “hosted Micro” is not a current product target.

## Generated artifacts

### Runtime entry

Each declared Micro profile emits one deterministic ESM runtime entry and one
declaration file. The entry:

- exports named typed wrappers, never a stringly generic application API;
- freezes its descriptors and shared generation tuple;
- imports only modules selected by the profile;
- contains no secrets or executable server code;
- has no top-level network or storage side effects; and
- remains readable and diffable rather than minified at source.

The application bundler performs ordinary tree shaking over named wrappers.
The semantic module selection comes from the declared profile, not from the
bundler's success at deleting code.

### Profile artifact

Codegen also emits a machine-readable `microProfile.v1` artifact that is not
imported by the runtime entry. It contains:

```text
formatVersion
profileName
packagingProfile                // micro.v1
capabilityClass                 // null for the first spike
selectedOperations[]            // id, name, kind, identity/contract hashes
expectedGeneration
modules[]
arm
lane
authProfileSet[]                // ids + must-understand versions
custodyOwner                    // none | caller | client-first-party | sender-client
carriers[]                      // immutable carrier + OS identity
explicitNonclaims[]
sourceDigest
runtimeEntryDigest
declarationDigest
```

The artifact itself is versioned and digest-bound into bundle and behavior
receipts. It is the explanation of why each module exists, the input to
capability-honesty checks, and the join between codegen output and measured
bytes. It is not sent to the browser merely so runtime code can interpret it.

### Compile and generation failures

At minimum, generation fails with stable structured diagnostics for:

- unknown or duplicate selected operation;
- operation kind unsupported by the selected profile;
- missing/concretely unknown argument or result contract;
- mixed or incomplete artifact generation;
- auth posture missing a required lane;
- selected target that does not advertise the argument-contract and
  result-contract capabilities D3's trust boundary depends on;
- selected live operation with no live module/route capability;
- first-party or sender custody selected without its required module;
- browser/Expo closure selecting an environment-inappropriate dependency;
- profile/runtime artifact digest drift; and
- generated wrapper/type output failing strict typecheck.

Exact code names should join the diagnostic registries governed by LLP 0010
and LLP 0012 during implementation; this RFC does not mint names without the
code-table owner.

## Runtime contract

### Request/response operations

The Micro runtime supports generated queries, mutations, and actions only.
Each request carries the named route, JSON arguments, the shared
`expectedGeneration`, the profile's required protocol offers, and the current
authority capture. It validates the generic response envelope and compares any
`facts.activeGeneration` with the request generation before publication. In a
sessions composition the fact is **required**, not merely compared if present —
LLP 0012 has successful sessions calls and subscriptions echo it — so absence is
itself a violation. Dev targets omit it, and the runtime expects that. Per D6
both failures are defensive checks a conforming server never trips.

Generated wrappers provide compile-time argument/result types. The runtime
does not carry `argumentSchema` or result descriptors. A hand-written or
malformed caller is stopped by the server's argument-contract seam; a malformed
handler result is stopped by the server's result-contract seam.

In v1, retry policy is **derived from the closed operation kind**, not carried
as a generated field — which is why neither the descriptor nor the profile
artifact has a retry member. There are exactly two classes, because per D4 no
Micro v1 mutation carries `clientMutationId` and there is therefore no
*effectful* operation a Micro v1 client may safely retry after ambiguity:

- `read`: queries may retry under the ordinary bounded transport policy while
  their authority capture remains current; and
- `nonIdempotent`: every mutation and action. Ambiguity surfaces a structured
  indeterminate-outcome diagnostic, never an automatic retry or a successful
  typed result.

An `idempotent` class is deliberately absent rather than reserved-and-unused. A
retry class is safety policy, and the only shipped mechanism that could justify
one is LLP 0043 settlement, which v1 does not adopt. Introducing the class
later makes retry policy a *declared* input, and that requires naming its
authoritative source, its request identity, its profile-artifact field, and its
compile-time diagnostic — none of which exist today. Codegen never infers
idempotency from operation name or HTTP verb, and it may not infer it from the
absence of a declaration either.

### Live operations

The Micro live module implements the applicable subset of LLP 0095's abstract
state machine, not a second ad hoc protocol. At minimum it owns:

- grant open and selected lane attachment;
- snapshot-with-subscribe;
- queued pre-snapshot frames;
- strict-newer version application;
- both replace and delta frames;
- connection-wide and subscription-scoped resync;
- bounded reconnect followed by fresh subscribe with `supersedes`;
- explicit unsubscribe and establishing-owner retention;
- grant-loss reopen and complete re-establishment;
- authority invalidation quarantine/apply/ACK where selected; and
- terminal auth closure.

Micro intentionally takes a fresh snapshot in cases where Full may resume from
retained state. It does not omit the state transition itself.

### React projection

`@expo/snapback-react` gains a Micro entry that binds to the generated Micro
client without importing `SnapbackClient`, RQS, the Full external-store family,
or `prepareReactBinding()`'s generic manifest interpreter. Its preparation is
a synchronous/deterministic check of the already-generated profile identity
plus the asynchronous runtime connection/auth readiness the selected posture
actually needs.

The public hooks continue to accept generated references or generated wrapper
bindings, never string operation names or caller-selected result generics. The
Micro React store owns active memory only, `useSyncExternalStore` publication,
generation fencing, cleanup, and the profile's conservative resnapshot policy.

Moving the admission seam is a coordinated amendment to LLP 0114 and a
two-package landing. A headless spike may land before that amendment, but no
React byte or behavior claim may use the Full admission path and call itself a
Micro result.

## Packaging and compatibility

The rollout is additive:

- `@expo/snapback-client` and `@expo/snapback-client/online` keep current
  behavior;
- `@expo/snapback-client/micro` is the small runtime implementation seam;
- codegen emits an application-owned entry, and application code imports that
  entry rather than constructing the runtime manually;
- `@expo/snapback-react` exposes a Micro-specific binding only after the LLP
  0114 amendment lands;
- generic tooling, admin tooling, runtime discovery, and applications needing
  offline/retained/optimistic semantics continue to use Full; and
- unsupported capabilities fail at generation/typecheck when statically known,
  leaving the already-registered `SNAPBACK_CAPABILITY_UNSUPPORTED` for
  genuinely dynamic target mismatches.

No source compatibility claim implies semantic compatibility between Full and
Micro. Documentation must publish a capability/nonclaim table beside the
migration recipe.

## Implementation sequence

### Phase A — metrology and low-risk separation

Extend LLP 0063 Workstream 8's committed cost-attribution manifest with
public-package fixtures for Full, Micro core, Micro live, sessions composition,
React composition, browser, Expo/Metro, and one complete external application.
Freeze sources, bundler/minifier/compression settings, lock/integrity data, and
behavior commands before optimization.

In parallel, execute the LLP 0145 packaging hygiene that benefits both
profiles: remove browser reachability to the Node file store, remove root
barrel imports, declare/test `sideEffects`, separate compact client operation
metadata from server manifests, and carry admin methods out of the application
graph per the prior CLI-fold decision. The React admission move remains Phase
D because it changes a public seam.

### Phase B — local-dev compiled core

Implement the logical profile input, generated runtime/declaration entry,
profile artifact, `core`, `operations`, `authority-fence`, and the smallest
`live` module. Rebuild the LLP 0145 incident-room subset with query, mutation,
action, one authorized live collection, multi-client delivery, user-switch
blanking, forced reconnect/resnapshot, one ambiguous mutation, and structured
version/capability failure.

Phase B also closes the delta-lane egress gap on the server, because D3's trust
boundary is what buys the client its byte reduction and gate 11a is red until
that lands. It is server work, not client work, and it is small; sequencing it
here keeps the first live measurement honest rather than measuring a client
whose premise is not yet true.

This phase claims no carrier and no exact generation enforcement. Its output is
an attributed byte floor and a list of missing conformance mechanisms, not a
product release.

### Phase C — sessions candidate

Add caller-custodied sessions, `auth/rr`, `auth/live`, the obligation seam, and
server-enforced call-time generation binding. Run the same workload and report
each auth module's marginal bytes separately. Pass the complete routed LLP 0095
fixture set for the declared tuple plus the demand-release and delayed-authority
families LLP 0145 identified as corpus gaps.

This is the first phase eligible to propose a Micro capability class. Per LLP
0145 D-C, the class and browser/Expo receipt facts are added to LLP 0064 only
after the spike demonstrates what it actually does.

### Phase D — React, carrier evidence, and publication

Amend LLP 0114, land the Micro React binding, run real-browser acceptance, and
then run Expo/Metro closure and per-OS behavior only for carriers the release
intends to claim. First-party custody and sender-constrained hosted auth remain
separate measured additions, never inferred from the caller-custodied sessions
result.

Publish only after the package vector and application-generated artifact are
digest-bound into one receipt under LLP 0041's publication rules.

## Graduation gates

The Micro profile graduates only when all applicable gates pass against the
same generated artifact digest.

"Applicable" is scoped by the profile's *declared* selections, never by the
convenience of the evidence in hand. Product graduation always includes the
sessions-composition gates, because per §Summary that is where the call-time
generation assertion is enforced; local-dev-only evidence never graduates,
however green. A profile that declares live queries always includes the live
and delta gates. A gate is inapplicable only when the profile makes the
corresponding explicit nonclaim, and the profile artifact records that nonclaim.

### Size and closure

1. The first headless local-dev runtime is at most 20 kB gzip and at most
   25 kB including its generated incident-room entry.
2. Attribution proves the runtime contains no server handler source, full
   schema/function/capability manifest, Full React admission, Node/file store,
   RQS, retained state, outbox, replay, admin, or other explicit nonclaim.
3. Browser and Expo/Metro closure tests reject environment-inappropriate
   modules.
4. Sessions, React, and later auth compositions report separate raw, minified,
   gzip, Brotli, parse/startup, and whole-application totals; a small headless
   core cannot hide an oversized required composition.
5. Capability-matched whole-application bytes improve on Full. The reduced
   incident-room subset is never compared with the original full-workout
   baseline as though they exercised the same product.

### Compile-time proof

6. Generated wrappers typecheck under strict TypeScript with exact arguments
   and results and no application-authored casts or result generics.
7. Negative generation fixtures cover every failure family in §Compile and
   generation failures.
7a. Specifically, a profile selecting a target that does not advertise the
   argument-contract and result-contract capabilities refuses at generation
   with a stable diagnostic. This is the fixture behind D3's fail-closed guard;
   without it the trust boundary is prose.
8. Regeneration is byte-identical, and any selected operation, contract,
   generation, posture, or module change rotates the appropriate artifact
   digest and receipt.
9. The runtime bundle can be reconstructed from the profile artifact's module
   list and attribution metafile; unexplained imports fail the gate.

### Runtime authority and validation

10. Malformed arguments from a raw/untyped caller refuse server-side before
    query/action handler dispatch or mutation effects.
11. Malformed handler results refuse at server egress; query/live publish
    nothing, mutations roll back, and actions report the refusal without
    claiming external-effect rollback.
11a. **The egress seam covers every client-bound publication, not just handler
    returns.** A live query whose declared result contract is narrower than its
    table schema, given a valid snapshot and then a schema-valid but
    contract-invalid row change, publishes no delta and no replacement carrying
    that row. The positive arm is fix-neutral by construction: a contract-valid
    change must still reach the subscriber within the fixture's bounded
    virtual-time deadline — as a validated delta, or
    as a validated replacement where the chosen fix refuses the lane for
    narrowed contracts — so a fix cannot pass by suppressing publication, and
    none of OQ10's three shapes is foreclosed by the gate. This gate is
    **green** as of `eda8f231`: narrowed `records` and non-schema-exact
    `documents` contracts take the validated replacement lane. The focused
    regression proves a contract-valid change still publishes while a
    contract-invalid change publishes neither a delta nor a replacement
    carrying the row. See
    `issues/closed/20260801-live-delta-frames-bypass-result-contract-validation.md`.
11b. Every remaining client-bound publication path a selected profile can reach
    — snapshot, replacement, resume, and any cache the target consults — is
    enumerated and shown to cross the same seam. The enumeration universe is
    mechanical, not an auditor's judgment: every constructor and serialization
    site of a client-bound envelope type. An unenumerated site fails the gate;
    "we found no counterexample" does not pass it.
12. Sessions calls generated for another app, an old generation, or a changed
    schema/function pair refuse before effects, including rollout
    interleavings. Success returns server-derived active-generation facts. The
    fixtures assert refusal for **fresh** admissions; D4's settled-replay
    carve-out is out of scope because Micro v1 sends no `clientMutationId`, and
    a negative fixture proves the generated client never emits one. The rollout
    interleaving is D6's no-overtake property, which LLP 0058 guarantees and the
    admission controller and retained-body tests already drive; the fixture
    seeds from those rather than re-deriving a harness. Micro's mismatch
    handling is exercised separately and labelled as defensive: a malformed
    sessions success covering both **absent** and unequal facts, proving the
    client's response to a non-conforming server, not a deployment race. A
    later composition adopting settlement re-scopes this gate **and D6's
    classification**.
13. Negative authorization and cross-user delayed-publication fixtures pass;
    every class named by the authority-fence contract is covered under a
    deterministic scheduler.
14. Every claimed operation kind—query, mutation, action, live—has positive
    multi-client acceptance and structured negative acceptance.
15. Ambiguous non-idempotent mutation and action outcomes are surfaced and
    never silently retried.
15a. The runtime's envelope floor is driven adversarially: non-JSON and
    over-budget bodies, a response of the wrong operation kind, a malformed
    diagnostic shape, malformed version/cursor fields, and an absent or
    non-string frame `kind` or a malformed payload for a recognized kind, each
    surface a structured error and publish nothing. A *syntactically valid*
    unknown string kind is not in this set: LLP 0095's tolerance floor requires
    it skipped and never fatal, and gate 16 imports that fixture. This is the
    last check before an opaque value becomes the generated type, so D3's floor
    needs a fixture rather than a paragraph.

### Live and auth conformance

16. The declared arm × lane × auth tuple passes every routed LLP 0095 fixture,
    including seeded negatives.
17. Subscribe → explicit unsubscribe/dispose proves server-side resource and
    demand release with the establishing owner; crash reaping is tested only
    as backstop.
18. Reconnect, version gap, and authority change blank and resnapshot without
    exposing predecessor live state as current. A deployment change blanks,
    raises the stale-artifact signal, and stays unreadable — the fixture proves
    the client does *not* loop on refused resubscribes, and that a regenerated
    successor client establishes the replacement subscription.
19. Where obligations apply, snapshot resolution applies before ACK,
    `terminalDelete` destructively retires before ACK and never resurrects,
    duplicates re-ACK safely, and foreign obligations are never acknowledged.
20. Every selected auth lane is driven by the Micro client itself. Running a
    standalone server harness does not establish client behavior.
21. Carrier evidence is per browser/OS tuple. No browser run implies iOS or
    Android behavior, and no closure test substitutes for runtime acceptance.

### Operational behavior and compatibility

22. Reconnect bytes, reconnect latency, and startup are no worse than Full on
    the same workload. Absolute numbers freeze at the first attribution run
    and never loosen except under LLP 0063's invalid-baseline procedure.
23. The existing Full client and all of its conformance suites remain green.
24. Package-root and `./online` compatibility fixtures prove the additive
    release did not silently select Micro semantics for existing consumers.

## 2026-08-02 Phases A–B implementation record

PKG-02 implemented the additive **local-dev-only** Phase-B profile. The public
surface is generated from a logical profile input into an exact declaration,
runtime entry, and digest-bound `microProfile.v1` artifact. The runtime is
split into `./micro/core` and the optional `./micro/live`; the compatibility
root and `./online` retain Full semantics. The profile explicitly records
nonclaims for sessions auth, retained reads, RQS, offline replay, optimistic
settlement, query groups, hosted carrier, capability class, and other
unimplemented compositions.

The immutable first attributed package ledger is
`tests/fixtures/client-bundle-metrology/baseline.micro-phase-b.v1.json`, sourced
from `95557db1`. Under the frozen Node 24.18.0 / esbuild 0.28.1 method it records:

- core runtime: 6,740 minified, **2,740 gzip**, 2,400 Brotli bytes;
- core plus generated entry: 7,347 minified, **2,960 gzip**, 2,595 Brotli bytes;
- live runtime: 12,470 minified, **4,549 gzip**, 3,989 Brotli bytes; and
- live plus generated entry: 12,868 minified, **4,712 gzip**, 4,134 Brotli bytes.

Both the 20 kB runtime and 25 kB generated-entry ceilings therefore pass with
substantial margin. Closure receipts prove core excludes live, both generated
entries exclude Full, RQS, outbox, and Node/file-store modules, and the root
negative imports neither Micro module. Strict TypeScript positive/negative
fixtures, capability and module-set refusals, byte-identical regeneration,
artifact-drift refusal, adversarial envelope tests, no-retry effectful
ambiguity, authority publication fencing, live version/resync behavior, and
explicit server-side unsubscribe cover the Phase-B compile/runtime floor.

Gate 11a's premise is independently green on current main. The fix at
`eda8f231` admits only schema-exact `documents(table)` to delta fanout; narrowed
contracts use the existing full re-query and validated `live_replace` path.
Both focused Rust arms pass: the contract-valid change is delivered and the
contract-invalid change publishes no application payload.

Gate 22's first attempted comparison was not admissible evidence. It reported
Micro 1,045 bytes against Full 700 because Full `liveQuery(ref)` had reduced a
generated reference to its name before fresh admission. That pre-existing Full
defect dropped the argument contract and complete generation tuple; 342 bytes
of the 345-byte gap were the tuple Micro correctly retained and three bytes
were unequal synthetic labels. The defect and its positive/negative proof are
isolated in
`issues/closed/20260802-full-livequery-drops-generated-reference.md` and the
prerequisite Full correctness commit `48fce9ff`. “Same workload” therefore
means **contract-correct Full**, not a smaller request obtained by violating
LLP 0012's call-time generation binding.

The first corrected local M5 Max / Node 25 attribution, using nine alternating
samples of poll/local `resync_required` followed by an exact superseding
snapshot, froze these values:

- reconnect: Full and Micro each **1,042 UTF-8 JSON body bytes** in two round
  trips (508 request + 534 response; equal transport headers/framing excluded);
- reconnect P50: Full **0.128958 ms**, Micro **0.072875 ms**; and
- startup P50: Full **18.477667 ms**, Micro **2.053000 ms**.

A labeled post-rebase confirmation retained 1,042 bytes/two round trips and
measured reconnect P50 Full 0.117875 ms versus Micro 0.068000 ms, and startup
P50 Full 16.227042 ms versus Micro 1.691167 ms. It confirms the gate but does
not replace or loosen the immutable first corrected receipt.

The Phase-B stop rule did **not** trigger: the size ceilings pass and the
unchecked transport/generated-surface split passes its negative proof gates
without importing the Full manifest interpreter. This is readiness to
commission a separately authorized Phase C, not Phase C implementation.
Sessions custody, auth obligations, a Micro capability class, React admission,
browser/Expo carrier evidence, publication, and any default-client change
remain explicit nonclaims. No capability or carrier is advertised from this
local-dev evidence.

## Consequences

### Benefits

- Ordinary application code gets a smaller and more legible API than a generic
  client while retaining exact generated types.
- The browser closure becomes proportional to selected runtime capabilities,
  not the entire Snapback platform.
- Server authority becomes clearer: client types help authors; server ingress,
  authorization, generation binding, and egress checks enforce reality.
- Agents receive earlier, more mechanical failures at generation/typecheck
  time and stable runtime diagnostics for genuinely dynamic mismatches.
- The Full client remains available for applications that value offline and
  retained behavior more than minimum initial bytes.

### Costs

- Snapback will maintain two client compositions and must prevent semantic
  drift with shared wire fixtures rather than shared monolithic code.
- A conservative Micro client can consume more network/server work through
  full resnapshots, and — because v1 carries no `clientMutationId` — every
  transport-ambiguous mutation becomes an application-visible indeterminate
  outcome where Full absorbs the same blip silently through LLP 0043 replay.
  A user-initiated second attempt may duplicate the effect; application authors
  must be told this rather than left to infer it.
- Whole-generation binding invalidates Micro entries after unrelated backend
  changes and requires lockstep regeneration in sessions deployments.
- Relying on server egress validation trusts the authoritative server rather
  than defending against it with duplicate application-payload validation —
  and makes every hole in that seam a Micro correctness bug rather than a
  defense-in-depth miss. The delta-lane gap D3 records is the first instance;
  gate 11b exists so the next one is found by enumeration rather than by a
  reviewer.
- Profile declarations, generated artifacts, byte receipts, and capability
  receipts add build-system surface area.

## Rejected alternatives

- **Make the raw generic transport the documented API.** Small, but abandons
  the generated authoring and capability-proof advantages.
- **Treat TypeScript as runtime validation.** It does not validate wire bytes
  or hostile/raw callers.
- **Keep generic client-side payload validation in Micro.** Duplicates the
  authoritative server seam and imports descriptors/interpreters that dominate
  the size goal; Full remains the defense-in-depth option.
- **Check deployment only at startup.** Leaves a deployment-change
  time-of-check/time-of-use window before an effectful call.
- **Add a new per-operation wire id immediately.** The current named routes and
  call-time whole-generation assertion already provide a conservative atomic
  mechanism in sessions mode.
- **Replace Full in place.** Breaks current offline, retained, optimistic,
  auth-custody, and `./online` semantics.
- **Use property mangling, WASM, or code golf as the architecture.** LLP 0145
  records lower diagnostic value, semantic risk, or no evidence of a smaller
  request/streaming client.

## Open questions

1. What source syntax declares a Micro profile and selected operations while
   remaining ergonomic for agents and deterministic for codegen?
2. Does the product entry export one `api` object, individual functions, or
   both, provided tree shaking and generated typing remain identical?
3. What exact browser capability class and receipt facts should LLP 0064 mint
   after Phase C? The first spike intentionally cannot answer this in advance.
4. Should first-party sessions custody become a separately named Micro
   composition or remain an optional module under the same packaging name?
5. What absolute byte ceiling should bind the sessions and React compositions
   after their first frozen attribution runs?
6. Does Metro/Hermes retain the same static module boundaries and byte savings
   as the browser build?
7. When real staged deployments make whole-generation invalidation too coarse,
   should the successor be per-operation expected identity, a server-minted
   lease, or immutable deployment pinning? No change is commissioned until the
   coarse mechanism produces measured pressure.
8. May a later revision narrow the v1 envelope floor D3 fixes, and on what
   evidence? The floor itself is decided and gated (15a); this question is only
   about shrinking it, never about shipping v1 with less.
9. Should codegen emit every selected wrapper in one entry or partition entries
   by route while sharing one immutable runtime chunk inside the same cache
   partition?
10. **Resolved for this implementation:** refuse the delta lane for narrowed
   contracts in favor of a validated replacement (`eda8f231`). Only the
   schema-exact `documents(table)` contract retains LLP 0090 D1's
   per-changed-row economy. A future element-wise proof may expand eligibility,
   but it is no longer a prerequisite or open choice for Phase B.

## Ratification and implementation posture

This RFC proposes D1–D7 as one composition. Acceptance would authorize the
new additive profile and the server-egress trust boundary, but would not by
itself advertise a carrier, change the default client, or claim the size target
has been met. Those claims require the graduation receipts above.

Implementation should stop after Phase B if the attributed runtime misses the
25 kB generated-entry ceiling or if the unchecked-core/generated-surface split
cannot pass the negative proof gates without re-importing the Full manifest
interpreter. The evidence then returns to LLP 0145 rather than relaxing the
budget or safety contract.
