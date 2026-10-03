# Small social

An Expo Router app with Following, chats, a pinned conversation, search and
profile screens. Backend forms and generated types: `snapback/schema.q`, `check`. Client recipes: `snapback4 guide social`.

```sh
npm install
npx snapback4 check
npx snapback4 dev
# In another terminal:
npm start
# or npm run web, npm run ios:dev
```

`snapback/workers/notifications.mjs`: dev/serve supervise the worker and inject its token.
`ledger: true` records successful completions durably beside the backend store;
keep that file with backups. Add your provider call, passing
`meta.idempotencyKey`, then emit `notify` from your mutation or digest job.
The starter does not send or emit notifications until you connect it. Delivery
is at least once: provider idempotency covers a crash after the call but before
the ledger commit. `npx snapback4 doctor` shows worker state; `guide effects`
contains the complete provider example. There is no separate worker launcher.

At every milestone, run `npm run export:ios` for the Hermes export;
on a Mac with Xcode, `npm run native:smoke` (about 3 minutes warm).
The smoke builds and installs the Release app, chooses its own simulator and free
port, and writes `artifacts/native-smoke/<timestamp>`. It proves local store
acquisition, cold offline reopen and reconnect. The starter uses normal guest
sign-in during smoke if no account is restored. An empty partition proves only
lifecycle; pending write replay and application assertions need the deeper
scenario in `snapback4 guide witness`. Xcode/runtime installation is a prerequisite;
the first build takes longer. Hermes export alone proves no native execution.

Use Node 24. Expo 57 and its Babel preset are pinned together. The browser
uses the wasm replica; a development/production native build uses
`snapback4-expo`. Expo Go uses the online tier and has no retained history
offline. Change the app's bundle IDs before building your own native app.
For another host or phone set `EXPO_PUBLIC_SNAPBACK_URL`; the simulator uses localhost:4400.

Sign up or continue as a guest. Save a profile, then post. Open another
browser profile or simulator, sign in as another account and exchange the
account IDs from Profile. Follow that ID to populate Following. Create a
chat and invite the other ID, or use Message on their profile to open a DM. Leaving keeps only history
this replica acquired; a remaining member can invite the departed account
again. Reload preserves the URL, account and replica. Guests cannot recover
their account after explicit sign-out; use passwords for that walkthrough.

Avatar uploads are ordinary images. Attach once photo uploads an image for
one viewing per account. Select View once photo, then Open media; close it
and try again to see `E_ASSET_VIEWED`. The viewer lives above the history
list; loading or recycling cannot fetch another view or revoke the handle. Close, identity change and a late result after close all
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
SDK default: plain revalidation retains, change evidence bounds it; no cache holds
old protected answers. A gap shows Loading while keeping draft and focus.
Membership and receipt decorations withdraw immediately. No-horizon membership
shares the messages' audience within the conversation's group; after acquisition,
`absent` proves absence at the acquired watermark unless pending work blocks it.
Queueing a durable write needs no membership answer: only `denied`, or
`existence(member) === "absent"` when fresh and not revalidating, disables Send.
A stale absent row offline still queues; the server authorizes or refuses at sync.
`loading` and `partial` never disable Send. Protected content needs a current
answer; retained rows grant no authority. Account change clears UI
state through `AppProvider`. Delivery is reported by the SDK's
`reports delivery` binding; only foreground visible settled messages report
`seen`. The receipts clause assigns ordinals, recipient counts and join floors
at server commit. Sends queue offline without predicted history rows. Receipts appear on each bubble, using the same cursor as its history
page. `usePendingWrites` shows outstanding sends and posts. Every send saves
its ID and complete arguments (including the attachment ID) in an account-
and backend-scoped intent journal before dispatch. Each saved ID observes its
own settlement; Edit restores a failed message, and Dismiss removes only the
UI reference. Unknown outcomes never trigger automatic resubmission.

## Direct messages and coverage

Profile's Message opens the private replicated `(owner, peer)` lookup.
Loading never creates a chat. After a complete miss, creation enters SDK custody
and opens a minted ID offline. The server atomically deduplicates both directions.
Settlement updates the route ID, keeping the composer under the opening write ID.
Lookup rows have no horizon and survive leave; they grant no membership or content.
Receipt scopes and joins queue without predicted rows; pending-write state keeps
the proposed route and composer while settlement chooses the canonical ID.
Refused sends stay editable after reopening: one private route lookup resolves their saved links, retired with each proposal’s last send.

History uses `messages where .conversation = conversation last 20 by
byConversationOrdinal after c`, as `guide sync` teaches. Its safe leading
equality establishes the same scope and coverage as a bracket prefix.
Receipt pages share that index and history cursor.

Likes declare `sync public last 2000 by .at with own keys .principal`.
Ordinary `exists likes[post, viewer]` answers “did I like this?” from the
caller's complete key partition, even outside the public window. Before
that partition is acquired an unknown like remains loading, never false.
Other viewers' old keys are not covered. Inspect `client.residency()` for holdings; see `guide offline-interactions`.

Search uses one ordinary query per scope: `search` across conversations and
`searchChat` pinned to one conversation. Online, the replica client combines
current server hits with this device's retained hits after leave; offline it
searches acquired holdings. The online tier has only current server access.
Immutable `conversation` and `at` give `(at, id)` continuation; `usePage` accumulates
by message ID. Refresh to see matches before the cursor. The screen shows “Partial
results” only when `existence(page.read) === "partial"`; nonempty answers are present
even with incomplete coverage. A complete page may still have more matches.
Search order is time and the acquired history window is ordinal, so missing
retained coverage can keep results incomplete. See `snapback4 guide search`
for cuts and continuation limits.

This small app deliberately has no push delivery, message deletion, expiry,
media cache, or background catch-up scan. Those features need their own
documented contracts; the receipt run recipe here assumes immutable message
positions with no deletion. `snapback4 guide receipts` explains the binding.


### Visible seen progress and independent history

After `check`, a receipts clause emits `api.receiptFamilies.chat`. Import
`useSeen` from `snapback4/react` on web or native:

```tsx
import { usePage, useSeen } from "snapback4/react";
import { api } from "../snapback/generated/api";

export function useReceiptScreen(id: string, visibleIds: ReadonlySet<string>, foreground: boolean) {
  const history = usePage(api.history, { conversation: id });
  const through = Math.max(0, ...history.items.filter(m => visibleIds.has(m.id) && !m.pending).map(m => m.ordinal));
  const seen = useSeen(api.receiptFamilies.chat, { scope: id, through, active: foreground });
  const decorations = usePage(api.messageReceipts, { conversation: id });
  return { history, seen, decorations };
}
```

Supply viewport IDs from the platform's actual visibility callbacks; intersect
with current confirmed rows and combine route focus with foreground. Reset IDs
on account/backend/scope change. Loaded history and acquisition do not mean seen.
Match current decorations by ID; their denial or loading never removes retained
history and grants no media authority. These reads are independent snapshots.

The hook shares monotonic progress and one admission/pending call per mounted
client/family/scope. Member withdrawals, replacement, session and store/generation
resets discard local progress; final unmount drops unadmitted progress. Admitted
writes remain in the SDK outbox through restart. The hook never pages history,
reads catch-up progress, or reports delivery. The descriptor's typed member/seen
handles, actual argument names, mapping and fingerprint come from the compiler.

`seen.state` is idle/admitting/pending/retrying/failed; `seen.through` is local
progress, never a confirmed receipt. `seen.why` exposes refusals. Known
E_ADMISSION/E_ADMISSION_STORE/E_ADMISSION_TIMEOUT failures retry with 1–60-second
backoff, at most eight retries while active. Reconnect or `seen.retry()` after
repair wakes those refusals. Other failures/unknown outcomes are not resubmitted.
See `snapback4 guide receipts` for the full rules and two-read recipe.
