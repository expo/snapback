---
title: Application surfaces
id: clients.surfaces
order: 2
audience: agent-first
capabilities: [clients.surfaces]
authorities: [llp/0179-generated-app-descriptor-and-surfaces.rfc.md, llp/0114-first-class-react-and-query-groups.spec.md, llp/0176-expo-messaging-golden-path.plan.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-react/index.mjs, packages/snapback-react/index.d.mts]
examples: [packages/snapback-react/surface.test.mjs, packages/snapback-react/fixtures/conversation/app/snapback/generated/app.descriptor.json, packages/snapback-react/fixtures/conversation/app/snapback/generated/app.d.ts, demos/expo-golden-path-fixture/snapback/functions.mjs, demos/expo-golden-path-fixture/snapback/surface-model.mjs, demos/expo-golden-path-fixture/src/screens/chat-screen.tsx, demos/expo-golden-path-fixture/tests/g2-falsification.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.10
unreleased: true
reviewed: 2026-08-06
reviewed-commit: HEAD
---

# Application surfaces

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

> **Unreleased.** This surface is newer than the newest published Snapback
> closure, 0.1.9. Use a runtime built from this checkout until 0.1.10 ships.

An **application surface** is one generated, parameterized composition of the
reads, ordinary mutations, raw asset intents, and presence lanes that belong
to a resource or screen. Declare it on the backend with `defineSurface`; bind
it in React with `useSurface`, or use `observeSnapbackSurface` and
`provider.surface(...)` without React. This is the vocabulary split to keep in
mind: backend searches use **surface declaration** and `defineSurface`, while
client searches use **screen surface**, `useSurface`, and
`observeSnapbackSurface`.

A surface composes existing generated references. It adds no endpoint, cache,
authorization layer, query language, or presence implementation. The low-level
[React hooks](./react.md) remain available and share the same owners.

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
- `commands` is part of the grammar, but generation currently refuses every
  command member; see [the v1 boundary](#stay-inside-the-v1-boundary).

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
  const upload = useSnapbackAssetUpload({ upload: conversation.assets.image.reference });
  const { details, memberships, messages, reactions, users } = conversation.state;
  const activeUser = conversation.data.users?.find((user) => user._id === activeUserId);
  const userById = useMemo(() => new Map((conversation.data.users ?? []).map((user) => [user._id, user])), [conversation.data.users]);
  const messageById = useMemo(() => new Map((conversation.data.messages ?? []).map((message) => [message._id, message])), [conversation.data.messages]);
  const typingNames = [...new Set(conversation.presence.typing.members
    .filter((entry) => entry.key !== conversation.presence.typing.selfKey)
    .map((entry) => entry.value.displayName))];
```

The snapshot exposes five member namespaces plus its descriptor:

- `data.<read>` is exactly `state.<read>.data`. It is the compact row/value
  projection and is `undefined`, never a fabricated `[]`, while that child is
  pending, skipped, or errored.
- `state.<read>` is the complete LLP 0114 query snapshot: `status`
  (`pending | ready | refreshing | error | skipped`), `data`, `error`,
  `freshness` (`unknown | retained | current`), `connection`, and the
  `retention` fact.
- `mutations.<name>(inputs)` is a typed ordinary mutation callable. Its input
  contains only the generated member's unbound inputs.
- `presence.<name>` is the existing per-room presence state with `entries`
  re-exported as `members`; status, connection, diagnostic, `selfKey`, and
  room actions remain available.
- `assets.<name>` exposes the existing raw asset-task seam (`reference` and
  `start`). It is not the reserved command composition promised for S2.
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

- `snapshot()` for the same `data`/`state`/`mutations`/`presence`/`assets`/
  `descriptor` projection;
- `reads.<name>.snapshot()` and `reads.<name>.subscribe(listener)` for one
  child;
- `mutations.<name>(inputs)` and `assets.<name>.start(...)`;
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
| `SURFACE_MAX_MEMBERS` | 24 | Reads + mutations + assets + presence on one surface |
| `SURFACE_MAX_MEMBER_BINDINGS` | 32 | Binding leaves on one member |
| `SURFACE_MAX_SCOPE_RECORD_FIELDS` | 8 | Fields in one flat scope record |

Exceeding any ceiling fails generation with
`SNAPBACK_SURFACE_BUDGET_EXCEEDED`; it never truncates the descriptor. The
limits keep a surface resource-shaped instead of recreating one global app
store.

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
| `SNAPBACK_SURFACE_MEMBER_CLASS_UNSUPPORTED` | A member has the wrong reference class, `input()` appears on an unsupported member, the target is in the wrong namespace, or `commands` is nonempty in S1. |

Client-time `SNAPBACK_REACT_SURFACE_*` refusals are:

| Code | Trigger |
| --- | --- |
| `SNAPBACK_REACT_SURFACE_INVALID` | The reference is not the complete generated surface admitted by this prepared binding, or a generated binding kind cannot be projected. |
| `SNAPBACK_REACT_SURFACE_PARAMS_INVALID` | Params are not an object or their keys do not exactly match the generated declaration. |
| `SNAPBACK_REACT_SURFACE_OPTIONS_INVALID` | Options are not the closed `{ presence }` object, or they name an unknown presence member. |
| `SNAPBACK_REACT_SURFACE_INPUT_INVALID` | A mutation's unbound inputs are missing/unknown, or an asset call omits `file` or adds an unknown call field. |
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

This page is `maturity: partial` because the declaration object names
`commands`, but current codegen refuses a nonempty command namespace with
`SNAPBACK_SURFACE_MEMBER_CLASS_UNSUPPORTED` and the message “commands are
reserved for descriptor slice S2.” Use the ordinary `mutations` namespace and
raw `assets` task seam that exist today; do not present an asset-plus-mutation
sequence as one admitted command.

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
- **Do not force command composition into S1.** Stay on the
  [admitted mutation and raw-asset boundary](#stay-inside-the-v1-boundary)
  until descriptor slice S2 ships.
