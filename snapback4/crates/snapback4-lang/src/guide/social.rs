// @ref LLP 3000.028#8 — the executable snippets are the installed starter files.
pub(super) const CARD: &str = concat!(r##"# Social: one app, three client lifetimes

Build a messaging app from the social starter, with replica history and an online typing arm.
Its feed, chat list, conversation, search and profile use only the published client and generated types.

```sh
npx snapback4 new my-social --template social
cd my-social
npm install
npx snapback4 check
npx snapback4 dev
# In another terminal: npm start
```

The installed README explains native, Expo Go and web setup. Its Quarry file
keeps profiles, follows, Following, likes, retained conversations/messages,
DMs, SDK delivery reporting, typing, ordinary images and once images together.
History uses `where .conversation = conversation` on its explicit horizon
index, as `guide sync` teaches; receipt pages share its index and cursor.
Likes declare owner-key coverage and use ordinary `exists likes[post, viewer]`;
unknown coverage stays loading. See `guide offline-interactions`. Search uses
one ordinary query per scope, combining current server and retained device
hits online. `usePage` accumulates by message ID; only `existence(page.read) === "partial"` shows
“Partial results”. Conversation and time are immutable. See `guide search`.

For an explicit-ID send, `guide client` shows `usePendingItems` over text and
media custody, including success awaiting observation. Supply the conversation
predicate and both keys; the starter's auto-minted message key cannot be guessed
from a mutation ID. Keep saved references for failures/unknown outcomes.
`usePendingState` selects a pending like/repost value without changing its mutation.

## Background notifications

`snapback/workers/notifications.mjs` declares a supervised worker for dev and
serve, with `ledger: true` and an injected service token. Connect its provider
handler and pass `meta.idempotencyKey`; the completion ledger cannot close the
crash window after provider I/O but before its commit. The starter declares
`notify` but emits nothing until you wire that behavior. `guide effects` shows
the provider call and `doctor` shows the worker's state.

## Typing on the online arm

`createApp` owns the session and replica. This arm borrows its current bearer
without taking over rotation. Mount it for the signed-in screen, close it on
session change, and use it only for the generated ephemeral operations.

```ts
// src/useOnlineArm.ts
"##, include_str!("../../../snapback4/src/verbs/init/social/useOnlineArm.ts"), r##"```

The hook owns the observation and renewals. Call change on keystrokes and
stop on send, blur or backgrounding. Unmount and identity change dispose it.
Disconnect cancels renewal; reconnect needs a new keystroke. The four-second
server expiry covers failed cleanup, suspension and revoked membership.
Keep the membership check in both insert and update rules. Signals fail
offline, never enter the durable outbox and never replay after reconnect.
An unavailable hint never gates history or the composer.

```ts
// src/useTyping.ts
"##, include_str!("../../../snapback4/src/verbs/init/social/useTyping.ts"), r##"```

## Once-media handle ownership

The stable viewer above the list owns this hook. Only an explicit Open action
calls asset; render, revalidation and list remount never fetch it. Close and
account change revoke the handle; a late result is revoked before publication.
A second explicit open reaches the server and returns E_ASSET_VIEWED. Do not
persist once bytes, refetch on remount, or treat retained text as a media grant.
The point query in OnceViewer closes on a missing, denied or changed home row,
not on loading. This starter has no message expiry or deletion; for expiring
media keep its known deadline ticking through loading (`guide client`).

```ts
// src/useOnceMedia.ts
"##, include_str!("../../../snapback4/src/verbs/init/social/useOnceMedia.ts"), r##"```

## A screen that survives revalidation

The Router pins conversation to the URL ID, even after its inbox membership
disappears. Mount this screen keyed by that ID within AppProvider. The composer
and once viewer sit above transient query states. Room and history choose the
SDK default: plain revalidation, inserts and non-policy updates retain; possible revocation bounds it to one second
after the replacement attempt starts. Decorations withdraw immediately. No application state caches protected rows.
Loading, refusal and retained history leave draft and focus owned by the same
screen; identity reset still clears them. Revealing/consuming protected content
needs a current answer. Queueing a durable write needs no membership answer:
only `denied`, or `existence(member) === "absent"` when fresh and not revalidating, disables Send.
Stale offline absence still queues; the server authorizes or refuses at sync. `loading`/`partial` never disable. The SDK reports delivery; the screen reports only visible seen
positions. The starter passes foreground and navigation visibility explicitly.

```tsx
// src/Conversation.tsx
"##, include_str!("../../../snapback4/src/verbs/init/social/Conversation.tsx"), r##"```

## Direct messages and route resolution

Profile's Message button opens `app/dm/[other].tsx`, which mounts `src/Direct.tsx`.
It waits for a complete, non-revalidating lookup; loading never means absence.
`directChats` holds two immutable unique `(owner, peer)` rows per DM, synced to
owner without a horizon. Each participant can resolve their held DMs offline,
even after leaving; the ID grants no content access or new membership.
`openDirect` checks the caller's key and inserts both keys and memberships in
one server transaction. Concurrent opens return the same ID. With acquired coverage,
the scope, memberships and keys predict together; history shows pending sends in
compose order. Server settlement chooses the canonical ID and message order (guide receipts).
Before creating, the resolver awaits the durable pending-write list: the hook's initial empty snapshot is still loading.

```tsx
// src/Direct.tsx
"##, include_str!("../../../snapback4/src/verbs/init/social/Direct.tsx"), r##"```

After custody, navigation pins the minted conversation ID with the opening write
ID. `app/conversation/[id].tsx` observes that write and the replicated lookup:
a replay may lack a result. Settlement uses `router.setParams({ id })` to replace
the URL ID without replacing the screen. Its `opening` key keeps the composer;
history changes keys and reads current rows. No answer is cached in a ref.
An offline send to a provisional ID may be refused if the server chose another
conversation; saving the send also saves its peer in account/backend-scoped storage.
One lookup by the current conversation resolves its links on reopen, showing Edit/Dismiss.
The last send's success or dismissal removes its link; openings alone save none. Admitted arguments stay unchanged.
"##);
