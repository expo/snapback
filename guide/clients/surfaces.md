---
title: Application surfaces
id: clients.surfaces
order: 2
audience: agent-first
capabilities: [clients.surfaces]
authorities: [llp/0179-generated-app-descriptor-and-surfaces.rfc.md, llp/0180-asset-bearing-client-commands.rfc.md, llp/0181-zero-configuration-expo.rfc.md, llp/0114-first-class-react-and-query-groups.spec.md, llp/0176-expo-messaging-golden-path.plan.md, llp/0210-asset-upload-dx-closure.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-client/commands.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-expo/asset-source.mjs, packages/snapback-react/index.mjs, packages/snapback-react/index.d.mts]
examples: [packages/snapback-codegen/app-descriptor.test.mjs, packages/snapback-react/surface.test.mjs, packages/snapback-react/commands.test.mjs, packages/snapback-client/commands.test.mjs, packages/snapback-react/fixtures/conversation/app/snapback/generated/app.descriptor.json, packages/snapback-react/fixtures/conversation/app/snapback/generated/app.d.ts, demos/expo-golden-path-fixture/snapback/functions.mjs, demos/expo-golden-path-fixture/snapback/surface-model.mjs, demos/expo-golden-path-fixture/src/screens/chat-screen.tsx, demos/expo-golden-path-fixture/tests/g2-falsification.mjs, demos/expo-golden-path-fixture/tests/g3-command.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.11
reviewed: 2026-08-25
reviewed-authorities-digest: sha256:3f24f88bcfb4bd7cf6c24c2b6fe7631c261188320c7c430eaf9978a660573079
---

# Application surfaces

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

An **application surface** is one generated, parameterized composition of the
reads, ordinary mutations, asset-bearing commands, raw asset intents, and
presence lanes that belong to a resource or screen. Declare it on the backend
with `defineSurface`; bind it in React with `useSurface`, or use
`observeSnapbackSurface` and `provider.surface(...)` without React. This is the
vocabulary split to keep in mind: backend searches use **surface declaration**
and `defineSurface`, while client searches use **screen surface**,
`useSurface`, and `observeSnapbackSurface`.

A surface composes existing generated references. It adds no endpoint, cache,
authorization layer, query language, or presence implementation. The low-level
[React hooks](./react.md) remain available and share the same owners.

## Declare one asset-bearing command

Use `defineCommand` for the closed LLP 0180 composition: exactly one ordinary
mutation plus zero or one asset input. The call inputs are derived rather than
declared again. Every mutation argument remains an ordinary command input
except the mapped `mutationArg`, which the asset task supplies after it
finalizes. An optional asset makes text-only and one-image sends branches of
the same typed call.

```js source=demos/expo-golden-path-fixture/snapback/functions.mjs
export const send = defineCommand({
  mutation: sendMessage,
  assets: {
    image: {
      intent: messageImageUpload,
      optional: true,
      mutationArg: 'image',
    },
  },
});
```

The composed mutation is still the sole application-row and asset-attachment
commit. The command adds no server endpoint or transaction, and it does not
change the upload intent's policy or ownership rules.

<!-- since: 0.1.16 -->

### Map required and optional assets safely

Command asset requiredness may narrow the ordinary mutation without changing
the mutation's own callable contract:

| Command child | Mutation argument | Result |
| --- | --- | --- |
| Required (`optional: false`) | Optional `v.assetRef` for the same upload intent | Admitted. The generated command requires the asset and always supplies it; direct mutation callers may still omit the argument. |
| Optional (`optional: true`) | Required `v.assetRef` | Refused. A text-only command branch would invoke the mutation without a required argument. |

The admitted direction is useful for a dedicated `sendPhoto` command over a
shared mutation that also supports a direct text-only call. The generated
command input is required, but the mutation handler must still treat the
argument as optional because other callers retain the wider mutation
contract.

The unsafe inverse refuses at generation with
`SNAPBACK_COMMAND_ASSET_MAPPING_INCOMPATIBLE`. Its diagnostic names both
repairs: **make the command child required**, or **make the mutation argument
optional** with `v.optional(v.assetRef(...))`. Do not weaken a required command
just to match an optional mutation argument; required-child → optional-argument
is the admitted narrowing.

## Declare a surface for one screen

Import `defineSurface`, `bind`, `param`, and `input` from
`@expo/snapback-codegen/define`. The Expo golden-path backend declares its
conversation once and binds `conversationId` through every scoped child:

```js source=demos/expo-golden-path-fixture/snapback/functions.mjs
export const conversation = defineSurface({
  params: { conversationId: v.id('conversations') },
  reads: {
    users: bind(users, {}),
    details: bind(conversationDetails, { conversationId: param('conversationId') }),
    memberships: bind(membershipsForConversation, { conversationId: param('conversationId') }),
    messages: bind(messagesForConversation, { conversationId: param('conversationId') }),
    reactions: bind(reactionsForConversation, { conversationId: param('conversationId') }),
  },
  mutations: {
    // @ref LLP 0176#g2--conversation-surface — keep the generated member at
    // the accepted north-star spelling while the underlying function remains
    // the ordinary addReaction mutation.
    react: bind(addReaction, {
      conversationId: param('conversationId'),
      messageId: input('messageId'),
      userId: input('userId'),
      emoji: input('emoji'),
    }),
    sendText: bind(sendText, {
      conversationId: param('conversationId'),
      senderId: input('senderId'),
      text: input('text'),
    }),
    sendReply: bind(sendReply, {
      conversationId: param('conversationId'),
      senderId: input('senderId'),
      text: input('text'),
      replyToId: input('replyToId'),
    }),
    removeReaction: bind(removeReaction, {
      reactionId: input('reactionId'),
    }),
    sendImage: bind(sendImage, {
      conversationId: param('conversationId'),
      senderId: input('senderId'),
      assetId: input('assetId'),
      caption: input('caption'),
      replyToId: input('replyToId'),
    }),
  },
  commands: {
    // This seeded Relay-shaped test persona binds Ada as the visible app-data
    // sender. Ordinary Sessions authority remains separate and is still
    // independently required by both the upload intent and mutation.
    send: bind(send, {
      conversationId: param('conversationId'),
      senderId: 'user_ada',
      body: input('body'),
      image: input('image'),
      failAfterFinalize: false,
    }),
  },
  assets: {
    image: bind(messageImageUpload, {}),
  },
  presence: {
    typing: bind(typing, {
      scope: { conversationId: param('conversationId') },
    }),
  },
});
```

The declaration has six named fields:

- `params` declares up to eight portable validators. `param('name')`
  substitutes one of those values into a child binding.
- `reads`, `mutations`, `assets`, and `presence` bind locally authored
  generated references. `input('name')` leaves a mutation or asset value for
  the eventual caller.
- `commands` binds an exported `defineCommand` descriptor without treating it
  as a mutation. Its caller supplies only unbound ordinary and asset-source
  inputs.

A binding leaf may be `param(name)`, `input(name)`, or a portable scalar
literal (`null`, string, boolean, or finite number). An object-shaped target
may instead receive one bounded **flat scope record**, such as
`{ scope: { conversationId: param('conversationId') } }`; its values use the
same leaves. It is not a general object-construction escape hatch.

The grammar is deliberately closed: no callbacks, conditionals, loops,
computed fields, inheritance, nested surfaces, or result transforms. Put
composition outside that algebra in application code or extend the subsystem
that owns the missing operation. Binding a resource id selects scope; every
child still performs its own existing authorization.

Surface member names are authored projection names, not rewrites of the
underlying operation. The example deliberately exposes `mutations.react`
while its reference remains the ordinary `addReaction` mutation, giving the
screen its resource-shaped vocabulary without hiding the inspected target.

## Inspect what generation emits

Codegen places every admitted declaration under the generated
`snapback.app.v1` descriptor's `surfaces` node. Each surface records its
parameter contracts and complete `reads`, `mutations`, `commands`, `assets`,
and `presence` maps. Every member records its generated reference, the complete
target-to-`param`/`input`/literal binding map, and an `inputs` map containing
only values the caller still supplies.

The codegen acceptance test makes that distinction explicit:

```js source=packages/snapback-codegen/app-descriptor.test.mjs
  assert.deepEqual(descriptor.surfaces.items.mutations.create.bindings, {
    group: { kind: 'param', name: 'group' },
    title: { kind: 'input', name: 'title' },
  });
  assert.deepEqual(Object.keys(descriptor.surfaces.items.mutations.create.inputs), ['title']);
```

The tracked React fixture's
[descriptor JSON](repo:packages/snapback-react/fixtures/conversation/app/snapback/generated/app.descriptor.json)
is the portable inspection artifact. Its
[`app.d.ts`](repo:packages/snapback-react/fixtures/conversation/app/snapback/generated/app.d.ts)
turns the same `inputs` map into the member's call type: for example,
`addReaction` accepts `messageId`, `userId`, and `emoji`, but not the already
bound `conversationId`. The separate `provider-bindings.d.ts` continues to
describe the underlying raw mutation's complete arguments; the omission is a
property of the generated surface member, not a mutation-signature rewrite.

Do not ask a caller for a bound parameter again. The complete descriptor
mapping remains available to inspection and auth review even though the
surface callable type omits it.

An optional input you omit is omitted from the composed operation payload —
the binding never materializes `key: undefined`; passing `undefined`
explicitly is refused before any network work.

## Run a command and read its truthful outcome

Call a bound command through `surface.commands.<name>(inputs)`, or obtain the
same owner directly with `useSnapbackCommand(app.commands.<name>)` — without
React, `invokeSnapbackCommand(provider, app.commands.<name>, inputs)` from
`@expo/snapback-react`, or `createCommandClient(client)` over a bare
`SnapbackClient` with no provider at all
([the headless client](./headless.md#call-ordinary-functions)). All of these
return one stable command task. The task snapshot derives these phases from its
existing asset-task and mutation-attempt children:

| Phase | Fact |
| --- | --- |
| `preparing` | Inputs and the captured authority cohort are being checked. |
| `transferring` | The existing asset task is reserving, transferring, or finalizing. Absent for text-only calls. |
| `committing` | The one ordinary mutation has been invoked. |
| `succeeded` | Mutation settlement proved the application commit. |
| `failed` | A trust boundary proved refusal or failure. |
| `ambiguous` | Mutation invocation began, but no commit/refusal proof arrived. |
| `cancelled` | Cancellation completed before mutation invocation. |

`task.done` resolves to `committed`, `failed`, `ambiguous`, `cancelled`, or the
`notRetryable` result of an invalid retry. It rejects only for local input or
source validation before network work starts. Retrying a failed or ambiguous
task returns a successor generation and preserves the mutation attempt
identity needed to reconcile a possibly committed attempt.

Finalized bytes are not a rollback receipt. If the mutation fails after
finalization, the terminal task retains the ready asset child and reports
residue with `unattached: 'authoritative' | 'inferred' | 'unknown'`. Current
LLP 0044 child facts do not prove global non-attachment, so a proved
same-authority mutation refusal is `inferred`; missing settlement or authority
replacement is `unknown`. Cleanup remains the declared LLP 0044 lifecycle
policy.

Cancellation before the mutation cancels the asset child when one exists.
Cancellation after mutation invocation is `ambiguous`, never a fabricated
rollback. Authority replacement does not adopt a task into the successor
principal; each retry revalidates its captured cohort.

### Expo ImagePicker input

Inside `SnapbackExpoProvider`, pass an `expo-image-picker` asset directly to
the bound command. Text-only and image send are branches of one typed call:

```tsx source=demos/expo-golden-path-fixture/src/screens/chat-screen.tsx
      const outcome = await observeCommand(
        conversation.commands.send({ ...(body ? { body } : {}), image: picked }),
        'picked-image',
      );
```

The Expo provider owns picker-URI conversion, binary transport, integrity, and
ordinary-session custody registration; the screen owns only picker UX and
task rendering. The adapter supports `content://`, `ph://`, and `file://` in
the live process. It does not add background, restart, offline, or
attempt-grant semantics.

## Consume the surface from React

Pass the generated surface reference, its exact parameter object, and optional
presence publish values to `useSurface`. The real Expo screen uses both compact
render data and the rich child state:

```tsx source=demos/expo-golden-path-fixture/src/screens/chat-screen.tsx
  const conversation = useSurface(
    app.surfaces.conversation,
    { conversationId },
    { presence: { typing: draft.trim() || proofEnabled ? { displayName: PERSONA_NAMES[activeUserId] ?? 'Someone' } : skip } },
  );
  const connection = useSnapbackConnection();
  const outbox = useSnapbackOutbox();
  const { details, memberships, messages, reactions, users } = conversation.state;
  const activeUser = conversation.data.users?.find((user) => user._id === activeUserId);
  const userById = useMemo(() => new Map((conversation.data.users ?? []).map((user) => [user._id, user])), [conversation.data.users]);
  const messageById = useMemo(() => new Map((conversation.data.messages ?? []).map((message) => [message._id, message])), [conversation.data.messages]);
  const typingNames = [...new Set(conversation.presence.typing.members
    .filter((entry) => entry.key !== conversation.presence.typing.selfKey)
    .map((entry) => entry.value.displayName))];
```

The snapshot exposes six member namespaces plus its descriptor:

- `data.<read>` is exactly `state.<read>.data`. It is the compact row/value
  projection and is `undefined`, never a fabricated `[]`, while that child is
  pending, skipped, or errored.
- `state.<read>` is the complete LLP 0114 query snapshot: `status`
  (`pending | ready | refreshing | error | skipped`), `data`, `error`,
  `freshness` (`unknown | retained | current`), `connection`, and the
  `retention` fact.
- `mutations.<name>(inputs)` is a typed ordinary mutation callable. Its input
  contains only the generated member's unbound inputs.
- `commands.<name>(inputs)` returns the existing command task. It composes the
  existing asset and ordinary mutation owners without entering the mutations
  namespace.
- `presence.<name>` is the existing per-room presence state with `entries`
  re-exported as `members`; status, connection, diagnostic, `selfKey`, and
  room actions remain available.
- `assets.<name>` exposes the existing raw asset-task seam (`reference` and
  `start`) for workflows that do not fit the closed command grammar.
- `descriptor` is the exact admitted generated surface reference.

`skip` from `@expo/snapback-react` opts one presence member out of publishing
without dropping its read-side room. A declared presence member missing from
the options object also defaults to `skip`. Presence self identity is derived
from the adopted session and connection. A publish payload containing its own
`userId` refuses locally with
`SNAPBACK_REACT_SURFACE_PRESENCE_IDENTITY_INPUT`; publish only the collection's
non-identity value fields.

## Observe the same surface without React

Use `bindSnapbackSurface(provider, surface, params, options)` or its provider
alias `provider.surface(...)` when another framework owns rendering. The
listener convenience is
`observeSnapbackSurface(provider, surface, params, options, listener)`.
The returned owner provides:

- `snapshot()` for the same `data`/`state`/`mutations`/`commands`/`presence`/
  `assets`/`descriptor` projection;
- `reads.<name>.snapshot()` and `reads.<name>.subscribe(listener)` for one
  child;
- `mutations.<name>(inputs)`, `commands.<name>(inputs)`, and
  `assets.<name>.start(...)`;
- `update(params, options)` to retarget that bound owner; and
- `dispose()` for all of its owned edges.

This is one owner shared with the low-level hooks, not a second subscription
layer. The package test binds a low-level query and a surface to the same
reference and arguments, then asserts object identity:

```js source=packages/snapback-react/surface.test.mjs
assert.strictEqual(
  surface.snapshot().state.messages,
  lowLevel.snapshot().queries.messages,
  'surface and low-level reads observe the exact same LLP 0114 store snapshot',
);
assert.strictEqual(surface.snapshot().data.messages, surface.snapshot().state.messages.data);
```

Mixing `useSurface`, `useSnapbackQuery`, and `observeSnapbackQueries` for the
same provider/reference/arguments therefore shares the same store snapshot and
upstream subscription. Equivalent presence joins the same canonical room.

## Change parameters without leaking predecessor state

A headless `update(params, options)` prepares the successor read descriptors
and presence rooms before releasing each predecessor room and lease exactly
once. Compact data becomes `undefined` across the handoff instead of showing
rows from the old scope:

```js source=packages/snapback-react/surface.test.mjs
surface.update(
  { conversationId: 'conversation-two' },
  { presence: { typing: { displayName: 'Ada' } } },
);
assert.equal(surface.snapshot().data.messages, undefined, 'parameter replacement cannot leak predecessor rows');
await flush();
assert.equal(surface.snapshot().data.messages[0].conversationId, 'conversation-two');
assert.equal(directMessages.at(-1).data[0].conversationId, 'conversation-two');
assert.deepEqual(client.metrics().rooms, [
  { conversationId: 'conversation-one' },
  { conversationId: 'conversation-two' },
]);
assert.equal(provider.inspection().presenceStores, 1, 'predecessor room is released after successor adoption');
```

With `useSurface`, a React render whose params change creates a successor
binding and retires the predecessor generation. A mutation callable captured
from that predecessor cannot act for the successor:

```js source=packages/snapback-react/surface.test.mjs
assert.throws(
  () => predecessorMutation({ messageId: 'stale-message', userId: 'user-ada', emoji: '⛔' }),
  (error) => error?.code === 'SNAPBACK_REACT_SURFACE_GENERATION_STALE',
  'a captured mutation callable cannot act for a retired parameter generation',
);
```

Read mutation callables from the current hook result instead of retaining one
across a parameter change. Provider disposal and authority replacement apply
the same generation fences and blank predecessor compact data.

## Stay within the generation budgets

Codegen enforces these exact ceilings before it emits a surface:

| Ceiling | Maximum | Counted unit |
| --- | ---: | --- |
| `SURFACE_MAX_PER_APP` | 32 | Surfaces in one app |
| `SURFACE_MAX_PARAMS` | 8 | Parameters on one surface |
| `SURFACE_MAX_MEMBERS` | 24 | Reads + mutations + commands + assets + presence on one surface |
| `SURFACE_MAX_MEMBER_BINDINGS` | 32 | Binding leaves on one member |
| `SURFACE_MAX_SCOPE_RECORD_FIELDS` | 8 | Fields in one flat scope record |

Exceeding any ceiling fails generation with
`SNAPBACK_SURFACE_BUDGET_EXCEEDED`; it never truncates the descriptor. The
limits keep a surface resource-shaped instead of recreating one global app
store.

The portable descriptor validator also measures the complete canonical UTF-8
document against the existing 16 MiB generation-protocol ceiling, and the
binding grammar permits only one flat object-keyed scope level. LLP 0179 leaves
the initial product-level descriptor-byte and binding-depth budgets as an open
question, so S2 does not invent tighter numeric ceilings.

## Act on every surface refusal

Generation-time `SNAPBACK_SURFACE_*` refusals are:

| Code | Trigger |
| --- | --- |
| `SNAPBACK_SURFACE_BUDGET_EXCEEDED` | An app, parameter list, member set, member binding, or scope record exceeds the ceiling above. |
| `SNAPBACK_SURFACE_INVALID_IDENTIFIER` | A surface export, parameter, or member name is not a portable non-reserved identifier. |
| `SNAPBACK_SURFACE_PARAMETER_UNKNOWN` | `param(name)` names no declared surface parameter. |
| `SNAPBACK_SURFACE_PARAMETER_TYPE_MISMATCH` | A parameter or portable literal does not match the target validator, or a parameter validator is invalid. |
| `SNAPBACK_SURFACE_INPUT_UNKNOWN` | A binding names no target argument, or a scope record names no target field. |
| `SNAPBACK_SURFACE_REQUIRED_INPUT_UNBOUND` | A required target argument or required scope field has no binding. |
| `SNAPBACK_SURFACE_REFERENCE_UNKNOWN` | The bound definition is not one exported generated app member. |
| `SNAPBACK_SURFACE_BINDING_AMBIGUOUS` | A definition has multiple export identities or one `input(name)` is bound more than once. |
| `SNAPBACK_SURFACE_BINDING_UNPORTABLE` | A binding uses nested/object construction outside one flat object-shaped target, or a literal is not portable JSON. |
| `SNAPBACK_SURFACE_AUTH_BINDING_REFUSED` | Application data attempts to bind a `Principal`; surface scope is not authority. |
| `SNAPBACK_SURFACE_MEMBER_CLASS_UNSUPPORTED` | A member has the wrong reference class, `input()` appears on an unsupported member, or the target is in the wrong namespace. |

Command declarations refuse at generation with their own stable codes. Every
one names the offending command and carries structured details; none of them
truncates or partially emits the descriptor:

| Code | Trigger |
| --- | --- |
| `SNAPBACK_COMMAND_INVALID_IDENTIFIER` | The command export name is not a portable non-reserved identifier. |
| `SNAPBACK_COMMAND_MUTATION_CARDINALITY_INVALID` | `mutation` is absent, `null`, or an array — v1 requires exactly one ordinary mutation. Details carry `mutations`. |
| `SNAPBACK_COMMAND_MUTATION_UNKNOWN` | The mutation target is not one generated ordinary mutation, or is missing from the generated mutation namespace. |
| `SNAPBACK_COMMAND_MAPPING_AMBIGUOUS` | The mutation or the asset intent has multiple generated export identities. |
| `SNAPBACK_COMMAND_MULTI_ASSET_UNSUPPORTED` | More than one asset input — v1 admits at most one. |
| `SNAPBACK_COMMAND_ASSET_INTENT_UNKNOWN` | `intent` resolves to no generated upload intent. |
| `SNAPBACK_COMMAND_ASSET_INTENT_ARGS_UNSUPPORTED` | The upload intent declares its own argument map; v1 commands do not carry a second one. |
| `SNAPBACK_COMMAND_ASSET_MAPPING_INCOMPATIBLE` | `mutationArg` is not a `v.assetRef({ upload: <this intent> })`, or an optional child maps to a required argument. A required child over an optional argument is admitted. |
| `SNAPBACK_COMMAND_INPUT_COLLISION` | The asset input name collides with a different ordinary mutation input. |
| `SNAPBACK_COMMAND_AUTHORITY_INPUT_REFUSED` | An ordinary input would inject an authority `Principal`. |

A running command task reports its own `SNAPBACK_COMMAND_*` diagnostics. These
are outcome facts, not authoring errors — branch on the code, and read
`status` for what it says about the server:

| Code | Terminal status | What it asserts |
| --- | --- | --- |
| `SNAPBACK_COMMAND_ASSET_FAILED` | `failed` | The asset child never finalized, so the mutation was never invoked. No residue. |
| `SNAPBACK_COMMAND_AUTHORITY_REPLACED` | `failed` | The captured authority cohort was replaced before invocation. The task is not adopted into the successor principal. |
| `SNAPBACK_COMMAND_MUTATION_FAILED` | `failed` | A trust boundary proved refusal — a receipt, a 401/403, an authorization diagnostic, or an explicit `effectCommitted: false`. |
| `SNAPBACK_COMMAND_MUTATION_AMBIGUOUS` | `ambiguous` | Invocation began and no settlement proof arrived. Anything short of proof lands here by design; the client never upgrades a guess to a refusal. |
| `SNAPBACK_COMMAND_CANCELLED` | `cancelled` | Cancellation completed before invocation; the asset child was cancelled where its state permitted. |
| `SNAPBACK_COMMAND_CANCELLED_DURING_COMMIT` | `ambiguous` | Local interest stopped after invocation. Never reported as `cancelled` — the server outcome is unknown. |
| `SNAPBACK_COMMAND_NOT_RETRYABLE` | (outcome only) | `retry()` on a committed, cleanly cancelled, or non-terminal task. The returned task carries the predecessor's terminal snapshot unchanged. |

`SNAPBACK_REACT_COMMAND_INVALID` refuses a command reference that is not the
complete generated command admitted by this prepared binding.

Client-time `SNAPBACK_REACT_SURFACE_*` refusals are:

| Code | Trigger |
| --- | --- |
| `SNAPBACK_REACT_SURFACE_INVALID` | The reference is not the complete generated surface admitted by this prepared binding, or a generated binding kind cannot be projected. |
| `SNAPBACK_REACT_SURFACE_PARAMS_INVALID` | Params are not an object or their keys do not exactly match the generated declaration. |
| `SNAPBACK_REACT_SURFACE_OPTIONS_INVALID` | Options are not the closed `{ presence }` object, or they name an unknown presence member. |
| `SNAPBACK_REACT_SURFACE_INPUT_INVALID` | A mutation or command's unbound inputs are missing/unknown, or an asset call omits `file` or adds an unknown call field. |
| `SNAPBACK_REACT_SURFACE_PRESENCE_IDENTITY_INPUT` | A non-skipped presence publish payload carries `userId`. |
| `SNAPBACK_REACT_SURFACE_GENERATION_STALE` | A mutation or asset callable belongs to a retired or disposed React surface generation. |

Treat the stable code as the branch key and its structured details as the
repair context; do not match message text.

## Render a cold retained boot

Descriptor-mode online preparation persists a compact admitted deployment
projection through LLP 0114's existing binding receipt and RQS store. On a
fresh offline client, the byte-identical descriptor reconstructs the admitted
function, RQS, ephemeral-policy, surface, and capability view before the
provider exists. The real-runtime acceptance proves the surface then renders
the retained rows through both projections:

```js source=demos/expo-golden-path-fixture/tests/g2-falsification.mjs
  await suite.check('descriptor cold boot renders retained message history through the surface', async () => {
    assert(await coldStore.loadReactBindingReceipt(), 'the exact binding receipt is present before cold preparation');
    const binding = await offline.prepareReactBinding({ generatedManifest: app });
    assert.equal(binding.source, 'persisted-receipt');
    offlineProvider = createSnapbackReactProvider(binding, { connectionId: 'g2-offline' });
    offlineSurface = observeSnapbackSurface(
      offlineProvider,
      app.surfaces.conversation,
      { conversationId: 'conversation_engine_room' },
      { presence: { typing: skip } },
      () => {},
    );
    await eventually(() => offlineSurface.snapshot().state.messages.freshness === 'retained');
    const snapshot = offlineSurface.snapshot();
    assert.equal(snapshot.data.messages.length, 3);
    assert.strictEqual(snapshot.data.messages, snapshot.state.messages.data);
    assert.equal(snapshot.state.messages.status, 'refreshing');
    assert.equal(snapshot.state.messages.connection, 'stale');
  });
```

The honest retained frame is `freshness: 'retained'`,
`status: 'refreshing'`, and `connection: 'stale'` until an authoritative
answer arrives. Surfaces add no cache, receipt format, retained-row copy, or
boot lifecycle of their own. A memory-only store still cannot survive a
process-cold boot; use the carrier rules on [the React client page](./react.md)
and [offline retention](../sync/offline-and-retention.md).

## Stay inside the v1 boundary

Commands admit only the closed online v1 shape: one ordinary mutation, zero or
one transient structural asset source, no callbacks or branching, and no
durable restart/offline custody. They do not admit multiple assets, attempt
grants, anonymous claim-on-attach, picker/content-URI adaptation, or generic
workflows. Use the ordinary `mutations` namespace and raw `assets` task seam
when the operation does not fit that grammar.

V1 also does not admit nested surfaces, inheritance, dynamic member creation,
one surface calling another, callbacks, or hidden result transformation. Reuse
happens through the existing generated references and their canonical owners.
The current proof is local-target only; no hosted application-surface claim is
made here.

## Anti-patterns

- **Do not hand-wire five `useSnapbackQuery` calls plus a presence hook when
  one generated composition exists.** [Declare the application surface](#declare-a-surface-for-one-screen)
  and [consume it with `useSurface`](#consume-the-surface-from-react); use
  low-level hooks only for composition outside the surface's closed grammar.
- **Do not pass a bound parameter again as a mutation input.** Inspect the
  generated member's reduced call type and
  [supply only its unbound inputs](#inspect-what-generation-emits).
- **Do not smuggle `userId` into a presence payload.**
  [Publish only non-identity collection values](#consume-the-surface-from-react);
  the session/connection owner supplies self identity.
- **Do not hold a `useSurface` mutation callable across a parameter change.**
  [Read it from the current generation](#change-parameters-without-leaking-predecessor-state)
  so a retired callable cannot act under successor scope.
- **Do not treat a finalized upload as an atomic send.** Use the
  [command outcome and residue facts](#run-a-command-and-read-its-truthful-outcome),
  and keep the raw asset and ordinary mutation children visible when a commit
  fails or becomes ambiguous.
- **Do not mirror mutation optionality mechanically onto a command child.** A
  [required child may deliberately narrow an optional mutation argument](#map-required-and-optional-assets-safely);
  only the unsafe optional-child → required-argument direction refuses.
