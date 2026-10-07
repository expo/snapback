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

The installed README covers native, Expo Go and web. Quarry keeps profiles, follows, Following, likes, retained chats, DMs, receipts, typing and ordinary/once images together.
History uses `where .conversation = conversation` on its explicit horizon
index, as `guide sync` teaches; receipt pages share its index and bound.
Likes declare owner-key coverage and use ordinary `exists likes[post, viewer]`;
unknown coverage stays loading. See `guide offline-interactions`. Search uses
one ordinary query per scope, combining current server and retained device
hits online. `usePage` accumulates by message ID; `readPresentation(page.read).incomplete` shows
“Partial results”. Conversation and time are immutable. See `guide search`.

Explicit-ID sends: `guide client` shows `usePendingItems`, including success awaiting observation. Supply conversation and both keys; never guess auto-minted message keys from mutation IDs. Keep references for failures/unknown outcomes.
`usePendingState` selects a pending like/repost value without changing its mutation.

## Background notifications

`snapback/workers/notifications.mjs` declares a supervised worker for dev and
serve, with `ledger: true` and an injected service token. Connect its provider
handler and pass `meta.idempotencyKey`; the completion ledger cannot close the
crash window after provider I/O but before its commit. The starter declares
`notify` but emits nothing until you wire that behavior. `guide effects` shows
the provider call and `doctor` shows the worker's state.

## Typing on the online arm

`createApp` owns session, replica and rotation. Mount this bearer-borrowing arm only for the signed-in screen; close on session change. Use only generated ephemeral operations.

```ts
// src/useOnlineArm.ts
"##, include_str!("../../../snapback4/src/verbs/init/social/useOnlineArm.ts"), r##"```

The hook owns observations/renewals. Call change on keystrokes; stop on send, blur or backgrounding. Unmount/identity change dispose it. Disconnect cancels renewal; reconnect needs a new keystroke.
Four-second expiry covers failed cleanup, suspension and revoked membership. Keep membership checks in insert/update rules. Signals fail offline, never enter the durable outbox or replay. Hints never gate history/composer.

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
Stale offline absence still queues; the server authorizes or refuses at sync. `loading`/`partial` never disable. The SDK reports delivery; `useSeen(api.receiptFamilies.chat, { scope, through, active })` reports only visible confirmed seen
positions. The starter passes foreground and navigation visibility explicitly.

```tsx
// src/Conversation.tsx
"##, include_str!("../../../snapback4/src/verbs/init/social/Conversation.tsx"), r##"```

## Jump to a quoted message

Mount `QuotedMessage` with the referenced message ID, even when it is outside the
loaded history page. The starter's `messagePhoto` point query returns the whole
message. Loading keeps a stable placeholder; only `absent` says unavailable.
`partial` is uncertain coverage, never absence; `denied` hides the quote.
Table rules may hide rows as absence: neither state proves deletion. No old
quote is cached across withdrawal. Test by holding the point read before settling it.
Reply saves only `replyTo`; the composer stays above the history owner. Pass
`onJump` to the quote. `useJumpToMessage` keeps visible targets in place; otherwise
it opens `history({ conversation, through: ordinal })`, one indexed 20-row window
ending at the original. Receipts use the same bound. Latest messages returns home.
One FlatList owns scrolling on native and web. Failed index measurements approach
the offset and retry for at most four seconds; full visibility starts a 1.8-second
highlight. Unknown/offline coverage or a timeout shows a failure, never a guessed
absence. Loading, denied and absent quotes have no jump action. Test a quote
behind 30 messages by its viewport rectangle and highlight, and keep a typed draft.

```tsx
// src/QuotedMessage.tsx
"##, include_str!("../../../snapback4/src/verbs/init/social/QuotedMessage.tsx"), r##"```

```ts
// src/useJumpToMessage.ts
"##, include_str!("../../../snapback4/src/verbs/init/social/useJumpToMessage.ts"), r##"```

## Bounded route-owned alternative

The installed `BoundedConversation` keeps its draft outside an active route
child. Supply `active={focused && foreground}` from PinnedConversation. Backend,
account, client and conversation changes reset the shell; the shared root marker
resets page/identity owners at every hard withdrawal, including generation changes.
It stores no answer or cursor. Three requested pages, at most 20 row-body readers,
and current point bodies give the example an explicit observation bound.
The full Conversation above also supplies saved-send recovery and receipts.

```ts
// src/PageLifetime.ts
"##, include_str!("../../../snapback4/src/verbs/init/social/PageLifetime.ts"), r##"```

```tsx
// src/BoundedConversation.tsx
"##, include_str!("../../../snapback4/src/verbs/init/social/BoundedConversation.tsx"), r##"```

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
