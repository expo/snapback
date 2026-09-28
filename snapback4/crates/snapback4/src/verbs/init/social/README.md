# Small social

An Expo Router app with Following, chats, a pinned conversation, search and
profile screens. All backend forms are in `snapback/schema.q`; `check` emits
their types. The three client recipes are also in `snapback4 guide social`.

```sh
npm install
npx snapback4 check
npx snapback4 dev
# In another terminal:
npm start
# or npm run web, npm run ios:dev
```

Use Node 24. Expo 57 and its Babel preset are pinned together. The browser
uses the wasm replica; a development/production native build uses
`snapback4-expo`. Expo Go uses the online tier and has no retained history
offline. Change the app's bundle IDs before building your own native app.
The iOS simulator uses `http://127.0.0.1:4400`. Set
`EXPO_PUBLIC_SNAPBACK_URL` for another host or a physical device.

Sign up or continue as a guest. Save a profile, then post. Open another
browser profile or simulator, sign in as another account and exchange the
account IDs from Profile. Follow that ID to populate Following. Create a
chat, invite the other ID, and exchange messages. Leaving keeps only history
this replica acquired; a remaining member can invite the departed account
again. Reload preserves the URL, account and replica. Guests cannot recover
their account after explicit sign-out; use passwords for that walkthrough.

Avatar uploads are ordinary images. Attach once photo uploads an image for
one viewing per account. Select View once photo, then Open media; close it
and try again to see `E_ASSET_VIEWED`. The viewer lives above the history
list. Loading or recycling that list cannot fetch another view or revoke
the current handle. Close, identity change and a late result after close all
release it. No once bytes are persisted; retained text grants no server media
access. Only JPEG, PNG and WebP are accepted; an unsupported library image
reports the server refusal.

`createApp` owns the account and local replica. `useOnlineArm` borrows the
current bearer for a short-lived `createClient` used only by typing; rotation
or account change closes that arm. `useTyping` owns its observation and short
renewal interval. Send, blur, inactivity, backgrounding, disconnect and
unmount stop it. Failed cleanup expires within the schema's four-second life.
Reconnect does not replay a hint; the next keystroke starts a new one. Typing
never enters the durable outbox and its availability never gates the composer.

`ConversationScreen` pins ordinary `history` to the route ID. The composer
and once viewer sit above transient lists; room, history and receipt
decorations have independent reads. History and room explicitly choose the
SDK's default one-second `revalidating` retention; no application cache holds
old protected answers. A gap shows Loading while keeping draft and focus.
Membership and receipt decorations withdraw immediately. Missing membership
keeps the draft and disables send; stale/retained/revalidating rows never grant
authority. The server still checks every action. Account change clears UI
state through `AppProvider`. Delivery is reported by the SDK's
`reports delivery` binding; only foreground visible settled messages report
`seen`. `usePendingWrites` shows outstanding sends and posts.

## Current coverage choices

Likes use the currently supported `ownLikes` aggregate. Despite its name it
is PUBLIC and horizon-free: every device acquires every principal's like
keys, beyond the 2,000-row public source window. At calibration scale that
recipe cost 5,008 groups / 1,121,792 logical row bytes just for likes. Measure
your own `client.residency()` or `snapback4 test --residency`. See
`snapback4 guide offline-interactions`. Replace this summary with ordinary
`exists likes[post, viewer]` only after source owner-key coverage ships.
An unknown like must remain loading; a missing windowed row is not false.

Per-chat search uses one ordinary unguarded pinned query in both link states.
The current all-chat recipe uses `searchNewest` for current memberships
online and `searchHeld` for this device's current and retained holdings
offline. It labels that domain difference explicitly. Search order is time;
the acquired history window is ordinal, so offline search can be incomplete.
No all-history or mixed-domain completeness claim is made. Adopt ordinary
all-chat search when its inferred audience and retained merge ship. See
`snapback4 guide search` for cuts and continuation limits.

This small app deliberately has no push delivery, message deletion, expiry,
media cache, or background catch-up scan. Those features need their own
documented contracts; the receipt run recipe here assumes immutable message
positions with no deletion. `snapback4 guide receipts` explains the binding.
