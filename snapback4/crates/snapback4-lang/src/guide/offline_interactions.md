# Offline interaction state: cover the viewer's own keys

Use source owner-key coverage for “did I like this?” outside the public window.
A missing own key proves absence only after that caller's whole key partition is acquired.

```quarry
table posts:
  author: principal
  public 'public posts'
  online only
table likes:
  post: posts
  principal: principal
  at: time
  unique post, principal
  immutable post, principal, at
  public 'public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by .at with own keys .principal
query postState(post: posts):
  return { liked: exists likes[post, viewer] }
```

The source must be non-expiring with a total immutable unique owner key and
caller-owned writes. The platform maintains a separate horizon-free partition
of this viewer's keys. Only after its whole partition is durably acquired can
a missing own key become false and complete. Another principal's key outside
the public window stays unknown; this proof does not supply row images or
aggregate totals. Offline answers remain stale relative to unseen remote writes.
Sign-out preserves the replica and the owner's proof for the same principal;
a different caller must acquire its own partition. Older devices without
`owner-key-coverage` refuse this backend. See `guide sync` and `guide feeds`.

Adoption backfills existing keys before publishing coverage. The owner index,
key rows and private log partition add storage and write work. Measure
`client.residency()` including `$ownKeys:likes`, plus acquisition and write costs;
every extant own key is replicated, so prolific owners can still be expensive.
The earlier private-table pilot held three like keys and one repost key for
u0500 in 568 logical row bytes. That pilot was not this implementation, and
its four-key size is neither a lifetime bound nor this policy's byte cost.

Social: `nativeDevice` on native, `webDevice()` on web, online in Expo Go. See `guide reads` for live timings and `guide sync` for acquisition and offline reopening.

## Conversation membership

A no-horizon membership table synced within the conversation's own group with the messages' audience holds every current readable membership after that group's first acquisition. The viewer's row is `present` or `absent` offline unless a pending prediction blocks absence. `loading` means acquisition or later withdrawal, not denial or absence. Offline `absent` is absence at the acquired watermark, including after leaving. This does not apply to windowed, online-only or differently partitioned memberships, or follow from retained messages.

```tsx
import { existence, isReady } from "snapback4/contract";
import { useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function SendPermission({ conversationId }: { conversationId: string }) {
  const member = useQuery(api.myMembership, { conversationId });
  const blocked = existence(member) === "denied" || (existence(member) === "absent" && isReady(member) && member.fresh && !member.revalidating);
  return <button disabled={blocked}>Send</button>;
}
```

Keep the composer mounted through `loading`/`partial`; neither disables send. Queueing needs no membership answer: only denial or fresh, non-revalidating absence disables Send. Stale offline absence still queues; the server authorizes or refuses at sync. `with own keys` remains for structurally caller-owned keys, never admin-written membership rows. See `guide client` for the complete composer.

## Public aggregate alternative and its cost

A public summary also supplies absence coverage, but replicates every viewer's
keys on every device. Use it when that public aggregate is itself required.

```quarry
table posts:
  author: principal
  public 'public posts'
  online only
table likes:
  post: posts
  principal: principal
  at: time
  unique post, principal
  immutable post, principal, at
  public 'public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by .at
view ownLikes: count likes by .principal, .post
query postState(post: posts):
  return { liked: ownLikes[viewer, post] > 0 }
```

This example deliberately emits N_MAINTAIN_SYNCED. At the `view` declaration,
`ownLikes` inherits public sync from `likes`, **without a horizon**. The name
does not make it private. Once the whole aggregate partition is acquired,
an absent group is zero and this query can answer false offline. The raw
`exists likes[post, viewer]` cannot prove a missing key below the public window;
an unknown Boolean must stay unavailable, never become false.

Calibration #24's full builder uses this view and the corresponding repost
summary. Its initial replica census was 5,008 like groups / 1,121,792 logical
row bytes plus 1,004 repost groups / 220,880 bytes: 6,012 rows / 1,342,672
bytes per device, including other viewers' keys. These are stored row bytes,
excluding indexes, transfer framing and database allocation. Measure your own
program with `snapback4 test --residency --fixture dir --as alice`, or inspect
an already adopted store with `check --residency`; `client.residency()` measures
the actual replica. No pre-adoption row count is a compiler estimate.

An explicit `read <- .principal = viewer` conflicts with that inherited
audience (E_SYNC). Adding `sync to .principal` to the view is also refused
(E_QUARRY_SYNTAX): a maintained view cannot declare a separate sync audience.
Remove the view's sync line, then keep `read <- allow` or omit read to retain
the public offline summary and its replica cost. Alternatively, add `online
only` and keep the owner read on the server; this loses offline aggregate
and absence coverage. Do not narrow the public source to make this view private.
See `guide maintains` for the inheritance rules.

Keep server-needing decorations separate.

## Retained message search

The social starter uses one ordinary search per scope in either link state.
Online, its replica client merges current server hits with certified retained
hits from departed conversations. Offline it searches this device's holdings;
an online-only client has no retained history. Keep the message's conversation
and order column immutable, and render `usePage`'s identity-keyed accumulation.
“Partial results” follows `readPresentation(page.read).incomplete`, including nonempty `present` answers with incomplete coverage, a cut or a continuation. Freshness is separate. Missing acquisition ranges and
cuts stay incomplete. See `guide search` for the compiling form and limits.
