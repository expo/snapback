---
title: "Recipe: messaging routes, retained threads, and convergence"
id: recipes.messaging-convergence
order: 18
audience: agent-first
capabilities: [backend.functions, clients.mutation-outcomes, clients.react, sync.offline, clients.outbox-drain]
authorities: [llp/0043-offline-replay-retention.rfc.md, llp/0056-scoped-roles-and-memberships.rfc.md, llp/0218-outbox-settlement-contract.rfc.md, llp/0317-clique-0129-correction-loop-disposition.research.md, demos/messaging-snapback/snapback/functions.mjs, demos/messaging-snapback/src/app/(tabs)/people.tsx, demos/messaging-snapback/tests/acceptance/headless.mjs, demos/messaging-snapback/tests/acceptance/roster-projection.mjs, packages/snapback-cli/templates/expo-chat/src/screens/chat-screen.tsx]
examples: [demos/messaging-snapback, packages/snapback-cli/templates/expo-chat]
status: current
targets: [local]
maturity: partial
authoring-profiles: [explicit]
reviewed: 2026-08-28
reviewed-authorities-digest: sha256:cdbb68320c23b1b3b6bf5007938436828c114c91ec8da88c4f7fba56169632d0
---

# Recipe: messaging routes, retained threads, and convergence

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use this page when a messaging journey crosses several boundaries at once:
opening a direct thread, navigating after a durable write, keeping an offline
thread honest, or reconciling sender, recipient, and second-client views. The
maintained recipe is a composition of separately verified surfaces. It is not
a claim that one matched end-to-end proof currently covers the whole journey.

The worked sources are Explicit. Familiar authors use the same server-owned
natural key, settlement, retention classification, and receipt trust boundary,
but author the query and mutation declarations in Familiar syntax. This page
does not claim a maintained Familiar messaging application.

## Open a direct conversation by natural key

If “Alice1 direct-route bootstrap still intermittently waited on a same-principal profile live query”, remove that client-side gate.
Do not wait for a same-principal profile live query before a direct-message
route can exist. Give the server one authenticated mutation that resolves the
two-person natural key, returns the existing canonical conversation id, or
creates the conversation and both membership projections atomically. The
shipped `startDirectMessage` mutation in `demos/messaging-snapback` is that
server operation, and its acceptance test proves repeated opens reuse the
canonical id.

Settle it with `queue: false` before navigating; repeated opens reuse the
canonical conversation id. The shipped example is Explicit. Familiar authors
use the same one-mutation server-side shape.

At the route, settle that one operation with `queue: false`, reject an
unexpected queued outcome, and navigate only with its canonical result:

```tsx source=demos/messaging-snapback/src/app/(tabs)/people.tsx
  async function openDm(otherHandle: string) {
    const other = PERSONAS.find((p) => p.handle === otherHandle);
    if (!other || opening) return;
    setOpening(otherHandle);
    try {
      const result = await client.mutate(api.startDirectMessage, {
        userId: self.handle,
        queue: false,
        args: {
          selfHandle: self.handle,
          selfName: self.name,
          otherHandle: other.handle,
          otherName: other.name,
        },
      });
      if (result.status !== 'settled') throw new Error('DM bootstrap unexpectedly queued');
      router.push({ pathname: '/conversation/[id]', params: { id: result.result } });
    } finally {
      setOpening(null);
    }
  }
```

The demo's `userId` and persona fields are dev-display inputs, not authority;
the mutation uses `ctx.auth.userId`. A real app must keep that boundary.

## Navigate after remove or disappear

This is the Router-navigation recipe for settled mutations that must survive page replacement.
Snapback does **not** currently ship a `settledNavigation` helper. Treat that
absence as a repair checklist, not permission to rely on a component promise:

Persist the navigation intent synchronously before page replacement, resume
the same idempotent operation at the destination, and gate the next
authority-sensitive action on a server witness. In full, this client-side
composition is profile-neutral:

1. Assign a stable idempotent operation identity and persist the navigation
   intent synchronously in route-appropriate durable host storage before page
   replacement.
2. Dispatch or resume that same operation identity at the destination. Do not
   turn an ambiguous response into a second user intent.
3. Observe the retained settlement when it exists, then gate the next
   authority-sensitive action on a server witness. For a leave/remove flow,
   use authoritative roster absence or the declared disappearance fact.
4. Clear the persisted navigation intent only after that witness. Navigation,
   an abandoned component promise, and mutation settlement alone do not prove
   subscriber convergence or lost authority.

This composition is profile-neutral. The missing helper remains explicit so an
agent searching for `settledNavigation` repairs the lifecycle instead of
inventing an API.

## Keep a retained thread, outbox, and composer honest

If a retained conversation went blank, the composer disappeared, or queued intent still existed, keep the axes separate.
The Expo chat template demonstrates the presentation shape: the thread stays
mounted, retained rows render with a saved-history label, and queued intent is
shown separately from connectivity.

```tsx source=packages/snapback-cli/templates/expo-chat/src/screens/chat-screen.tsx
  const retained = messages.freshness === 'retained';
  const commandBusy = commandSnapshot !== null
    && ['preparing', 'transferring', 'committing'].includes(commandSnapshot.status);
  const commandAsset = commandSnapshot && 'asset' in commandSnapshot ? commandSnapshot.asset : null;
  const progress = commandAsset?.totalBytes
    ? Math.round((commandAsset.bytesTransferred / commandAsset.totalBytes) * 100)
    : 0;
  const readError = [details, memberships, messages, reactions, usersState]
    .find((state) => state.status === 'error')?.error;
```

```tsx source=packages/snapback-cli/templates/expo-chat/src/screens/chat-screen.tsx
      <View style={styles.contextBar}>
        <View style={[styles.dot, { backgroundColor: connection.status === 'live' ? palette.success : palette.warning }]} />
        <Text style={styles.contextText}>{retained ? 'Saved history' : connection.status === 'live' ? 'Live' : 'Offline'}</Text>
        {outbox.status === 'ready' && outbox.pending > 0 ? <Text style={styles.queued}>{outbox.pending} queued</Text> : null}
      </View>
      {readError ? <Text style={styles.error}>{errorText(readError)}</Text> : null}
      <FlatList
        ref={listRef}
        contentContainerStyle={styles.messageList}
        data={conversation.data.messages ?? []}
        keyExtractor={(item) => item._id}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
```

That snippet is a UI witness, not proof that every query in the template is
retainable. Before promising saved history, inspect the generated handle's
`retention.retainable` classification and test the intended platform carrier.
Public exact queries can use default retention; protected conversations need
their declared lease-backed path. Expo SQLite physical-device qualification
remains a GAP. See [offline retention](../sync/offline-and-retention.md) for
the exact eligibility matrix.

Keep the composer mounted while retained rows are visible. Do not disable it
merely because `connection.status !== 'live'`: a qualified durable writer can
queue the intent. Disable for product reasons such as an empty draft or an
active media task, and surface actual outbox, custody, writer, or authority
refusals with their named repair. `useSnapbackOutbox()` reports queued work; it
does not itself grant writer or authority readiness. The current template is a
retained-conversation/outbox/composer presentation witness, not resolution of
any repro-gated offline blanking or provider-unmount defect.

## Converge sender, recipient, and second-client views

For “same-account live messaging, cross-device unread clearing, and dual-client offline convergence”, use one maintained answer with separate evidence at each seam.
Build the combined messaging journey from these maintained seams:

| Boundary | Shipped route and witness | Do not infer |
| --- | --- | --- |
| Optimistic sender echo and canonical id | [Optimistic create](./optimistic-create.md) covers provisional presentation, exact settlement, and canonical reconciliation. | Mutation settlement does not prove a recipient or a second subscription observed the row. |
| Offline intent and reconnect | [Offline retention and replay](../sync/offline-and-retention.md#replay-and-settle-without-guessing) preserves the original `clientMutationId` and exposes queued/failed/stranded state. | Equal row content, retries under a fresh id, or connectivity do not establish settlement. |
| Cross-device unread clearing | [Read receipts](./read-receipts.md) records an authenticated recipient's client acknowledgement. `demos/messaging-snapback` freezes the send-time recipient set, proves acknowledgement idempotence, and rejects a later joiner. | A client-authored acknowledgement is not a server-observed fetch primitive and cannot gate entitlement, deletion, or revocation. |
| Same-account or second-client observation | Mount the authoritative conversation/receipt queries in each context and wait for each context's own server snapshot or live revision. Use the provider-lifecycle and multiple-surface recipes when contexts share custody or a record. | One client's live state, a socket, or `hasFreshClient` does not prove another context observed these rows. |

This is now one maintained answer for same-account live messaging,
cross-device unread clearing, and dual-client offline convergence. The proof
remains seam-by-seam: there is still no single matched, maintained acceptance
run covering all of those boundaries together. Do not upgrade that evidence
claim until such a run exists.

In particular, durable exact settlement and offline replay are distinct from
client-authored acknowledgements, not a server-observed fetch primitive.

## Acceptance checklist

- Repeat the natural-key open and assert the same canonical conversation id.
- Simulate response loss and assert the original mutation identity settles;
  do not create a second domain intent.
- Stop the backend and assert only eligibility-proved rows render as
  `freshness: 'retained'`, with the stale axis and outbox count visible.
- Reconnect two contexts and assert each independently observes the canonical
  message and receipt state.
- Acknowledge twice and assert idempotence; try a post-send joiner and assert
  the frozen-recipient refusal.
- Keep separate verdicts for each seam unless one harness really drives the
  entire matched journey.
