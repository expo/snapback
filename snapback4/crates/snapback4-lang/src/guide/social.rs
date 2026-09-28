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
SDK delivery reporting, typing, ordinary images and once images together.
The current public like summary expands every replica; see
`guide offline-interactions` and the starter's census note. Until owner-key
coverage ships, a raw missing like is unknown, never false. The current
all-chat search labels current memberships online versus held history offline;
per-chat search is one ordinary pinned operation. See `guide search` for cuts.

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
default bounded one-second revalidating retention, independently of immediately
withdrawing decorations. No application state caches protected rows.
Loading, refusal and retained history leave draft and focus owned by the same
screen; identity reset still clears them. Revalidating/retained answers grant
no action authority. Missing membership disables Send, while server rules
decide writes. The SDK reports delivery; the screen reports only visible seen
positions. The starter passes foreground and navigation visibility explicitly.

```tsx
// src/Conversation.tsx
"##, include_str!("../../../snapback4/src/verbs/init/social/Conversation.tsx"), "```\n");
