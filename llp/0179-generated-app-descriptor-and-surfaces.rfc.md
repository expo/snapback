# LLP 0179: Generated AppDescriptor and application surfaces

**Type:** RFC
**Status:** Accepted
**Systems:** Application data API, Code generation, Client integration,
React/Expo, Live queries, Ephemeral state, Assets, Auth, Testing, Exact,
Contract
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-05
**Revised:** 2026-08-06 (i) — Appended the dated S2 delivery note: `commands`
is admitted as its own descriptor namespace at `17e7ca8ca` with the existing
S1 ceilings and canonical-byte measurement enforced, and `app-inspection.mjs`
is the language-neutral consumer that closes S2's non-React proof bullet.
Status unchanged. Earlier same day (h) — Reconciled §Headless projection with
shipped S1:
the non-React spelling is `observeSnapbackSurface` plus the prepared-provider
`surface`/`bindSnapbackSurface` seam, not the never-implemented
`client.surface`; the one-owner design is unchanged and `commands` remains
S2/G3 work. Earlier same day (g) — G2 surface-design revision: descriptor binding
must remain process-cold reachable through LLP 0114's single persisted
binding-receipt/RQS owner. The receipt retains a compact admitted deployment
projection for the byte-identical descriptor; surfaces gain no cache, receipt
format, or boot lifecycle of their own. Earlier same day (f) — Accepted by the author (Charlie Cheever,
LLP 0176 G1 gate). Per §React projection, this acceptance amends LLP 0114
to add `useSurface` as a named projection over its canonical stores; the
corresponding dated amendment is recorded in LLP 0114's own header and
§Named projections from accepted RFCs. S0 (descriptor spine) is
implemented and landed; S1/S2 remain delivery work under LLP 0176 G2/G3.
2026-08-05 (e) — Super-refine round 2 (delta): closed open
question 3 outright — the closed grammar and §React projection already
normatively admitted a surface-level `assets` re-export while the open
question presented the same decision as unmade; a reviewer correctly found
this the one genuinely pre-existing, unresolved MATERIAL gap left after
round 1. Also gave `useSnapbackCommand`'s LLP 0114 amendment its own
statement in LLP 0180 rather than only asserting it here on 0180's behalf,
and noted the scope-record grammar admission explicitly covers a
single-field record (the `typing` example does not need a "multi-field"
qualifier to be valid under it). 2026-08-05 (d) — Super-refine round 1: fixed a circular descriptor
identity (the digest was specified to cover the field that contains it);
fixed a presence-binding example that used a raw object literal outside the
closed grammar's admitted leaves; fixed a north-star example that let
application code supply an unauthenticated `userId` into presence data;
named LLP 0114 as a pending amendment owner for the React projection instead
of asserting it silently; completed the Summary's illustrative descriptor
literal so `satisfies AppDescriptor` type-checks as shown; and noted that S2
now maps into LLP 0176 G3. Also removed "Offline" from `Systems:` (this RFC
does not address it beyond one deferral clause) and added "Testing".
2026-08-05 (c) — Renamed the portable wire form from "manifest"
to "descriptor document" to stop colliding with this codebase's existing,
unrelated `manifest.rs`/deployment-manifest vocabulary; added an explicit
disambiguation note distinguishing `surfaces` (this RFC's bound-composition
noun) from the informal "React surface"/"Expo surface" usage already common
in the guide and diaries. 2026-08-05 (b) — Made one environment-independent
`AppDescriptor` the shared spine for LLPs 0179–0181; placed existing API
references, LLP 0180 commands, and application surfaces in separate
namespaces; separated ordinary mutations, command tasks, and raw asset tasks;
and deferred environment binding to LLP 0181.
**Related:** LLP 0000, LLP 0004, LLP 0012, LLP 0043, LLP 0044, LLP 0053, LLP
0064, LLP 0090, LLP 0107, LLP 0112, LLP 0114, LLP 0146, LLP 0157, LLP 0176,
LLP 0178, LLP 0180, LLP 0181

## Summary

Snapback already generates exact references for queries, mutations, asset
intents, ephemeral collections, and registered query groups. A screen still
has to discover and bind those references independently, repeat the same
resource scope, reconcile several state objects, and explain to every consumer
which operations belong together.

This RFC introduces two related things under one owner:

1. one stable, language-neutral **`AppDescriptor`** containing the complete
   generated application vocabulary; and
2. generated **application surfaces** that compose existing references around
   a resource or workflow and bind shared parameters once.

`AppDescriptor` is the only stable app model shared by this RFC, LLP 0180,
and LLP 0181. Commands are nodes inside it. Expo consumes it and supplies a
separate environment-specific `AppBinding`; Expo does not define a competing
descriptor.

Conceptually (this literal is complete against `AppDescriptorV1` below and
does type-check as a genuine `satisfies` assertion, not an illustrative
fragment — `format`/`identity`/`api.queryGroups` are shown, not omitted):

```ts
export const app = {
  format: "snapback.app.v1",
  identity: {
    app: "…", schema: "…", functions: "…", descriptor: "…",
  },
  api: {
    queries: { listMessages, getConversation },
    mutations: { reactToMessage, sendMessage },
    assets: { messageImageUpload },
    ephemeral: { typing },
    queryGroups: {},
  },
  commands: {
    send: sendCommand,
  },
  surfaces: {
    conversation: conversationSurface,
  },
  capabilities: {
    required: [/* generated portable requirements */],
  },
} satisfies AppDescriptorV1
```

Standalone generated exports remain available as aliases of nodes in this
tree. Existing applications do not need to adopt surfaces.

## Authority and scope

This RFC owns:

- the versioned, environment-independent `AppDescriptor` schema;
- how existing generated references are placed in that descriptor;
- the closed `defineSurface` declaration grammar;
- headless and React projections of a bound surface; and
- descriptor inspection, identity, and capability requirements.

It does not own:

- query stores, subscriptions, mutation attempts, optimistic state, or cleanup
  (LLP 0114 and existing client owners);
- asset attempts, attachment, policy, delivery, processing, or authorization
  (LLP 0044);
- command execution semantics (LLP 0180);
- endpoint/environment resolution, sessions, Expo lifecycle, config plugins,
  or Metro/EAS integration (LLP 0181);
- new query expressiveness (LLP 0080/0110/0120/0157); or
- Exact/Contract product semantics.

A surface compiles to and composes existing admitted references. It is not a
new server protocol, endpoint family, cache, authorization layer, workflow
engine, or query AST.

## Product principles

### One declaration, many projections

The application relationship is declared once. Generated TypeScript, a
portable descriptor document, headless bindings, React hooks, tests, inspection, and
future Exact/Contract consumers project the same descriptor identity.

### Stable app, variable environment

No `AppDescriptor` field depends on a URL, Metro host, EAS channel, local
port, current session, device installation, or selected persona. Those are
`AppBinding` or authority facts under LLP 0181 and the auth owners.

### Bind scope once

A surface parameter such as `conversationId` is supplied once and threaded
into every declared read, mutation, command, asset intent, and presence scope.
Generated call types omit only arguments that are fully and unambiguously
bound.

### Preserve rich facts

Compact `data` is a projection. Loading, retained data, partial/error state,
freshness, capability, mutation settlement, presence membership, and asset/
command phases remain observable through stable rich projections.

### No second owner

Equivalent low-level and surface calls converge on the same canonical client
keys and lifecycle owners. Mounting two equivalent surfaces cannot create
duplicate sockets, rooms, outboxes, asset tasks, or mutation identities.

## AppDescriptor v1

### Portable descriptor document and typed binding

> **Naming note.** This codebase already uses "manifest" for the generated
> schema/function deployment manifest (`crates/snapback/src/manifest.rs` and its 14+ guide
> references). Calling `AppDescriptor`'s portable wire form "the manifest" too
> would recreate exactly the vocabulary collision that made
> `useSnapbackPresence` undiscoverable from the schema's "ephemeral"
> terminology (LLP 0176 §Issue catalog D1). This document therefore always
> says **descriptor document** for the portable `snapback.app.v1` artifact,
> reserving "manifest" for the existing deployment manifest it references by
> identity but does not replace.

Generation emits:

- a language-neutral `snapback.app.v1` descriptor document containing
  identifiers, bindings, validators, provenance, and capability requirements
  (including the referenced deployment manifest's identity — it does not
  duplicate the manifest's own content); and
- a TypeScript module exporting typed/hydrated references over that
  descriptor document.

The portable form is the identity-bearing source. The TypeScript module does
not contain a second independently generated model.

The v1 logical shape is:

```ts
interface AppDescriptorV1 {
  readonly format: "snapback.app.v1"
  readonly identity: {
    readonly app: string
    readonly schema: string
    readonly functions: string
    readonly descriptor: string
  }
  readonly api: {
    readonly queries: Readonly<Record<string, QueryRef>>
    readonly mutations: Readonly<Record<string, MutationRef>>
    readonly assets: Readonly<Record<string, AssetIntentRef>>
    readonly ephemeral: Readonly<Record<string, EphemeralRef>>
    readonly queryGroups: Readonly<Record<string, QueryGroupRef>>
  }
  readonly commands: Readonly<Record<string, CommandDescriptor>>
  readonly surfaces: Readonly<Record<string, SurfaceDescriptor>>
  readonly capabilities: {
    readonly required: readonly CapabilityRequirement[]
  }
}
```

The exact identity fields reuse the existing generated artifact authorities;
this RFC does not define a weaker app hash. `identity.descriptor` **is** that
digest, so it cannot be part of its own preimage — a reviewer correctly
caught the earlier text specifying a hash that covered the field containing
it, which no implementation could satisfy. A round-2 delta review then
correctly found the first fix's "sentinel, or omitted entirely" phrasing
itself underspecified: those are two different serialized documents that
would produce two different digests, so v1 must pick exactly one. **V1
picks the sentinel form**: the canonical preimage is the complete document
serialized with `identity.descriptor` set to the fixed empty string `""`
(not omitted, not any other placeholder) before digesting; every other
portable field, including the rest of `identity`, participates normally.

A round-3 delta review correctly found that picking the sentinel still left
serialization itself unpinned: this descriptor contains object maps whose
key order and encoding could otherwise vary between the generator and a
future independent language-neutral producer (the exact consumer §Inspection
invites), each computing a different digest for what should be the same
identity. **V1 pins JSON Canonicalization Scheme (RFC 8785)** as the exact
preimage encoding: object member ordering by code-point-sorted UTF-16 key
comparison, no insignificant whitespace, and RFC 8785's number
serialization. Any producer of an `AppDescriptorV1` — the generator or a
future independent implementation — must serialize through JCS before
digesting, and a verifier does the same before comparing. This closes the
one remaining variable in the digest: sentinel value (fixed), preimage
encoding (now fixed), leaving only the actual field values as what the
digest measures.

### Namespace rules

- `api.queries` and `api.mutations` expose ordinary server operations.
- `api.assets` exposes raw advanced asset intents and tasks.
- `commands` exposes LLP 0180 composite client commands.
- `surfaces` exposes parameterized application compositions.
- `capabilities.required` states generated requirements; it does not claim
  that a current device or target satisfies them.

The separation is semantic, not cosmetic. In particular, an ordinary mutation
must not sometimes return a promise and sometimes return a multi-phase task
because a surface mixed it with commands.

### Existing exports

Existing generated imports remain source-compatible. New generation should
make these aliases where the module format permits:

```ts
export const listMessages = app.api.queries.listMessages
export const reactToMessage = app.api.mutations.reactToMessage
```

Inspection proves alias identity. There is no independently evolved
`api.mutations.reactToMessage` beside `app.api.mutations.reactToMessage`.

## Surface declaration

> **Naming note.** "Surface" already has an informal, established meaning in
> this codebase's guide and diaries — "the React surface," "the Expo surface,"
> "the JS surface" — meaning a client platform or binding target. This RFC's
> `surfaces` is a different, more specific noun: a generated, parameterized
> composition of existing reads/mutations/commands/presence around one
> resource, independent of which client platform consumes it. The same
> `app.surfaces.conversation` is bound from React, headless JS, or a future
> Exact/Contract consumer alike. Where this document says "surface" without
> qualification it always means this bound-composition sense; a reference to
> a client platform is spelled out as "client platform" or the specific target
> (React, Expo, headless) to avoid the ambiguity.

### Closed grammar

`defineSurface` accepts:

- a closed `params` object using portable validators;
- named `reads` bound to generated query/live-query references;
- named `mutations` bound to ordinary generated mutation references;
- named `commands` bound to LLP 0180 command descriptors;
- named `assets` bound to raw asset intents for advanced consumers — a
  round-2 delta review correctly found this bullet, plus §React
  projection's `assets.<name>` result namespace, already normatively
  admitted a surface-level `assets` re-export while a now-removed open
  question presented the same decision as unmade; the decision is: **yes**,
  a surface may re-export a bound `assets` namespace, exactly as this
  grammar and §React projection already specify, made explicit here instead
  of living only implicitly in two other sections;
- named `presence` lanes bound to generated ephemeral references; and
- bindings made only from `param(name)`, `input(name)` where that member
  admits call input, portable literal facts, or a **bounded scope record** —
  a flat object literal whose values are themselves only `param(name)`,
  `input(name)`, or a portable literal, admitted only where a bound
  reference's own shape is itself object-keyed (an ephemeral collection's
  `scope`, for instance, is an object regardless of whether a given
  collection happens to key it by one field or several — the `typing`
  example below has exactly one). A scope record does not nest, does not
  compute keys, and does not admit any other expression — it is sugar for
  "bind each named field of an already object-shaped target," not a general
  object-construction escape hatch.

V1 does not admit callbacks, arbitrary JavaScript mapping, conditional
queries, loops, computed field names, or result transformation. A requested
composition outside this grammar stays in application code or requires an
amendment at its real algebra owner.

Example:

```ts
export const conversation = defineSurface({
  params: {
    conversationId: v.id("conversations"),
  },
  reads: {
    messages: bind(listMessages, {
      conversationId: param("conversationId"),
    }),
    details: bind(getConversation, {
      conversationId: param("conversationId"),
    }),
  },
  mutations: {
    react: bind(reactToMessage, {
      conversationId: param("conversationId"),
      messageId: input("messageId"),
      emoji: input("emoji"),
    }),
  },
  commands: {
    send: bind(send, {
      conversationId: param("conversationId"),
      body: input("body"),
      image: input("image"),
    }),
  },
  presence: {
    // `scope` is a bounded scope record (§Closed grammar): a flat object
    // whose one field is itself an admitted `param(...)` binding, not an
    // arbitrary literal.
    typing: bind(typing, {
      scope: { conversationId: param("conversationId") },
    }),
  },
})
```

These are local authored references, not imports from the generated `app`
module. Codegen validates the acyclic declarations and then places their
generated identities under `app.api`, `app.commands`, and `app.surfaces`.

The generated input type for `react` is `{ messageId; emoji }`; it omits
`conversationId` because that parameter is bound. The descriptor still
records the complete binding so inspection, auth review, and other consumers
can see it.

### Binding is not authorization

Supplying `conversationId` selects scope. It does not prove membership,
ownership, or permission. Every query, mutation, presence lane, asset intent,
and command child performs its existing authorization at the existing seam.

Generation refuses:

- an unknown parameter or input;
- duplicate/ambiguous binding;
- a type-incompatible binding;
- an unbound required argument;
- an attempt to bind auth/principal from application data;
- an unsupported reference kind; or
- a surface that exceeds declared member/budget limits.

### React projection

LLP 0114 expressly owns React composition and public state semantics; this
RFC's `useSurface` and its result namespaces are framework-neutral
descriptor/task semantics projected *through* LLP 0114's existing hook
machinery, not a competing React authority. A reviewer correctly noted this
needs to be a stated amendment rather than an implicit claim: accepting this
RFC amends LLP 0114 to add `useSurface` as a named projection over its
canonical stores, using the same retained/error/lifecycle/cleanup semantics
LLP 0114 already defines for `useSnapbackQuery`/`useSnapbackMutation`/
`useSnapbackPresence` — it does not invent a second set of React state rules.
LLP 0180's `useSnapbackCommand` amends LLP 0114 the same way for the command
projection. Until LLP 0114 accepts this amendment, `useSurface`'s React
semantics are proposed, not settled.

`useSurface` consumes a surface reference, bound params, and optional
ephemeral publish values:

```tsx
const chat = useSurface(app.surfaces.conversation, { conversationId }, {
  presence: {
    typing: isTyping ? {} : skip,
  },
})

chat.data.messages
chat.state.messages
chat.presence.typing.members
await chat.mutations.react({ messageId, emoji })

const task = chat.commands.send({ body, image: picked })
const { kind } = await task.done // "committed" | "failed" | "ambiguous" | "cancelled" | "notRetryable"
```

The publish payload above deliberately carries no identity field. A
reviewer correctly flagged an earlier draft of this example that let
application code supply `{ userId }` directly into a value other members
could read as that participant's identity — with nothing in this document
establishing that the field is validated, ignored, or overwritten, a caller
could publish another user's `userId` and have it rendered as fact. Self
identity in every presence lane is derived from the adopted session by the
existing ephemeral/presence owner, never taken from application-supplied
publish data; a surface's publish object carries only non-identity payload
fields (here, none are needed — "who is typing" is the room's own
membership fact, not something the typing participant states about
themselves).

The v1 result has deliberately distinct projections:

- `data.<read>` is the smallest render-oriented value;
- `state.<read>` is the existing rich query/store state;
- `mutations.<name>` returns the ordinary mutation result;
- `commands.<name>` returns the command task defined by LLP 0180;
- `assets.<name>`, when declared, exposes the existing raw asset task API;
  and
- `presence.<name>` exposes members, publish status, and existing room facts.

Exact spellings may change during review, but these semantic namespaces may
not collapse.

The optional publish object controls only this component's presence
contribution. `skip` removes/does not publish that contribution through the
existing presence lifecycle. It does not unsubscribe the read side or create a
new room.

### Headless projection

The headless client can prepare the same surface:

```ts
const chat = client.surface(app.surfaces.conversation, { conversationId })

const stop = chat.reads.messages.subscribe(listener)
await chat.mutations.react({ messageId, emoji })
const task = chat.commands.send({ body, image })
```

Headless bindings expose the same canonical keys, capability requirements,
child references, and cleanup. React is a lifecycle projection over this
owner, not the definition of a surface.

**2026-08-06 — shipped v1 spelling.** S1 ships the non-React observer seam as
`observeSnapbackSurface(provider, surface, params, options, listener)` from
`@expo/snapback-react` (`packages/snapback-react/index.mjs`), alongside
`provider.surface(...)` on the prepared React provider and the exported
`bindSnapbackSurface(...)`; surface admission itself remains in
`packages/snapback-client/react-binding.mjs`. The `client.surface(...)`
spelling in the example above was never implemented. This follows the existing
`observeSnapbackQueries`, `observeSnapbackPresence`, and
`observeSnapbackOutbox` precedent, giving non-React consumers the same owner
without a second registry. The normative contract above therefore holds
unchanged for the shipped spelling: canonical keys, capability requirements,
child references, and cleanup remain shared, with React only a lifecycle
projection over the one owner. The adversarial assertion in
`packages/snapback-react/surface.test.mjs` requires
`surface.snapshot().state.messages` and
`observeSnapbackQueries(...).snapshot().queries.messages` to be the same object
("surface and low-level reads observe the exact same LLP 0114 store snapshot"),
and its Strict Mode case with a low-level sibling requires exactly one upstream
message subscription. The shipped spelling of the example above is:

```ts
const chat = provider.surface(app.surfaces.conversation, { conversationId })
// or, without holding the provider value: observeSnapbackSurface(
//   provider, app.surfaces.conversation, { conversationId }, options, listener)

const stop = chat.reads.messages.subscribe(listener)
await chat.mutations.addReaction({ messageId, userId, emoji })
await chat.dispose()
```

A client-side `client.surface` alias was considered and deliberately not added
in v1: no consumer asked for it, and a second public entry point to the same
owner would invite exactly the second-owner outcome this RFC forbids elsewhere.
Reopen that alias only on real demand from a non-React consumer that cannot use
the observer seam. The example's `commands` member is not admitted in S1:
codegen currently refuses it with `SNAPBACK_SURFACE_MEMBER_CLASS_UNSUPPORTED`
and "commands are reserved for descriptor slice S2"; it arrives with S2/G3.

## Lifecycle, identity, and composition

A surface binding has a canonical identity derived from descriptor identity,
surface id, normalized parameter values, authority cohort, and the existing
child-key inputs. The surface wrapper may memoize composition, but child
storage and transport remain owned by their current registries.

Changing parameters:

1. prepares the successor child set;
2. delegates retained/current-state behavior to each existing child owner;
3. changes presence contribution using existing room semantics; and
4. releases predecessor leases exactly once.

A wrapper may summarize child state but cannot retain facts after the
underlying owner would discard them, broaden an authority cohort, or call a
command/mutation on behalf of a stale parameter generation.

Nested surfaces, surface inheritance, dynamic member creation, and one surface
calling another are not admitted in v1. Reuse happens through shared query
groups and references, which preserve one canonical owner.

## Inspection and other consumers

`snapback-app introspect` and generated review material should answer, without
executing handlers:

- which API references, commands, and surfaces exist;
- each surface's parameters and member bindings;
- declared reads, writes, presence lanes, assets, and authority requirements;
- required target/client capabilities;
- provenance and source locations; and
- which standalone exports alias which descriptor nodes.

The portable descriptor document is intentionally suitable for Exact, Contract, tests,
and agent tools. V1 acceptance requires a language-neutral schema and at least
one non-React inspection/test consumer. Full Exact/Contract product
projections are deferred; this RFC does not guess their UI or policy model.

## AppBinding seam

An `AppDescriptor` is not runnable by itself. A client needs an
environment-specific `AppBinding` from LLP 0181. Binding admission verifies:

- app/schema/function/descriptor identities;
- client/target protocol and capability compatibility;
- target provenance and expiry where applicable; and
- absence of a development/release source mismatch.

Session authority is adopted separately through the existing auth owner. The
descriptor never contains a bearer or a persona, and a binding never becomes
authority merely because its endpoint is reachable.

The seam is also the descriptor's cold-boot seam. When live inspection is
unreachable, `prepareReactBinding({ generatedManifest: app })` delegates to
LLP 0114's existing persisted binding receipt. Because the portable descriptor
omits server-owned interiors, online admission stores only the compact
server-derived facts needed to reconstruct that owner's admitted function,
RQS, ephemeral-policy, and capability view; the byte-identical descriptor is
supplied again by the application. Admission still completes before a surface
or provider exists, descriptor/generation drift keeps the existing typed
binding mismatch, and `useSurface` merely projects whatever retained/current
facts LLP 0114's canonical stores truthfully hold.

## What remains explicit

Applications still declare:

- schema, indexes, functions, auth, visibility, and business refusals;
- asset media/delivery/privacy/processing policy;
- surface membership and the parameters that define application scope;
- command composition;
- retention/offline requirements; and
- environment targets under LLP 0181.

The surface shortens repeated wiring. It does not infer product policy from
names such as `conversation`, `messages`, or `send`.

## Non-goals

- A second application server, API gateway, query language, cache, store,
  outbox, mutation ledger, presence implementation, or asset state machine.
- A route or environment descriptor.
- Registered-bundle boot in v1. Generated modules may use today's ordinary
  module loading; a server-addressable bundle registry requires separate
  evidence and authority.
- Arbitrary callbacks or hidden data transformation in declarations.
- Automatic authorization inferred from bound resource ids.
- Nested/global surfaces that recreate one monolithic app store.
- Requiring React/Expo adoption or removing low-level generated exports.
- Claiming full Exact or Contract projection in v1.

## Delivery

### S0 — descriptor spine

- Freeze `snapback.app.v1` and emit the portable descriptor document plus typed binding.
- Place current generated references under `app.api` and prove standalone
  exports alias them.
- Emit descriptor identity, provenance, capability requirements, inspection,
  and negative admission fixtures.

This is LLP 0176 G1's first half and may land before surfaces.

### S1 — conversation surface

- Admit the closed declaration grammar and generate the messaging fixture's
  reads, reaction mutation, and typing presence.
- Implement headless binding and React `useSurface` over LLP 0114 owners.
- Prove canonical-key equality, parameter replacement, authority replacement,
  strict cleanup, and no duplicate subscription/room.

This is LLP 0176 G2.

### S2 — command member and wider consumers

- Admit LLP 0180 command references without folding them into mutations.
- Add one non-React descriptor consumer beyond headless execution (inspection,
  test generation, Exact, or Contract).
- Measure descriptor size and enforce member/depth budgets.

S2 does not require registered-bundle boot or full Exact/Contract UI. A
reviewer correctly found this slice previously mapped to no gate in LLP
0176's delivery program even though its `commands` admission is a
prerequisite for LLP 0180's own G3 work; S2 is now explicitly part of LLP
0176 G3 (see that Plan's G3 bullet list).

**2026-08-06 — S2 landed.** `17e7ca8ca` admits command references in the
descriptor's own `commands` namespace rather than folding them into
`mutations`: the root gains a `commandMap`, a surface's `commands` members
carry the same complete binding map and bound-parameter omission that reads
and mutations get, and `validateAppDescriptorV1` enforces the closed
`asset-bearing-command.v1` key set (`kind`, `mutation`, `asset`,
`passthroughArgs`) with canonical-byte measurement against
`APP_DESCRIPTOR_MAX_BYTES` and the existing S1 ceilings —
`SURFACE_MAX_PER_APP` 32, `SURFACE_MAX_PARAMS` 8, `SURFACE_MAX_MEMBERS` 24,
`SURFACE_MAX_MEMBER_BINDINGS` 32, `SURFACE_MAX_SCOPE_RECORD_FIELDS` 8, and no
recursion ([`packages/snapback-codegen/app-descriptor.mjs`](../packages/snapback-codegen/app-descriptor.mjs)).
A tighter product-level descriptor byte/depth budget stays this document's open
question and is documented as such in `guide/clients/surfaces.md`.

*Non-React consumer.*
[`packages/snapback-codegen/app-inspection.mjs`](../packages/snapback-codegen/app-inspection.mjs)
enumerates every api reference, every command (with its mutation reference,
asset intent, passthrough arguments, and the union of required capabilities),
and every surface member from the portable descriptor JSON alone — parsed from
disk, importing no generated binding, no React, and evaluating no application
handler; a source-level assertion in its test pins that. It satisfies this
document's §Acceptance "language-neutral consumer" bullet for the newly
admitted `commands` namespace, which the implementation landing left open.

What S2 does **not** prove: registered-bundle boot, an Exact or Contract UI
consumer, or any hosted/published-package descriptor claim.

## Acceptance

- One generated `AppDescriptor` is the identity-bearing source consumed by
  surfaces, commands, and LLP 0181.
- No environment URL, session, Metro, EAS, or device fact appears in it.
- Equivalent low-level and surface reads share the canonical LLP 0114 store;
  equivalent presence uses one room; ordinary mutations use the existing
  attempt owner; commands preserve their separate task type.
- Binding one resource parameter removes it from member call types while the
  descriptor retains the complete inspectable mapping.
- Parameter and authority changes do not display or mutate predecessor facts
  under successor scope.
- Unsupported callback, type mismatch, auth binding, recursion, and budget
  cases refuse at generation.
- A language-neutral consumer can enumerate all members and requirements
  without importing React or executing application handlers.

## Risks

### A surface could become a second framework

The closed grammar, reference-only members, and canonical child ownership keep
it a composition layer. New expressiveness belongs at the existing query,
mutation, asset, or presence owner.

### Compact data could hide degraded state

`data` is paired with stable rich `state`; tests require retained/error/
capability facts to remain reachable. A compact projection may not fabricate
empty or fresh data.

### Large surfaces could recreate a global store

V1 has member and descriptor budgets, no nesting, and resource parameters.
Applications compose several bounded surfaces instead of declaring “the app”
as one live object.

### Bound ids could be mistaken for authority

Every operation independently authorizes at its existing seam. Generated
inspection labels parameter binding as scope selection, never membership.

## Open questions

1. Should `data.<read>` return only authoritative current data, or the best
   renderable data with freshness retained in `state.<read>`?
2. What are the initial surface member, descriptor-byte, and binding-depth
   budgets?
3. Which non-React consumer best proves the portable descriptor without
   prematurely designing Exact/Contract projections?
4. Which existing artifact identity fields form the descriptor identity
   tuple, and which are redundant?

## Status

Review. The stable `AppDescriptor` is the load-bearing decision. Surface
syntax is valuable but can evolve behind that descriptor document.
Implementation should start with S0, then the one conversation surface in
S1; LLP 0181 must consume this descriptor and must not define another one.
A super-refine round-1 review found and fixed a circular descriptor-identity
specification, an ungrammatical presence-binding example, and an
unauthenticated-identity gap in the presence publish example — see the
`(d)` revision note above.
