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

## Seed accounts headlessly

After `npx snapback4 check`, with the backend running, set `SEED_PASSWORD`
privately in your environment and run `node scripts/seed.mjs` (Node 24).
`SEED_USERS=2` is the default; set it to N (1–1000) to create
`seed1@example.test` through `seedN@example.test`. `SNAPBACK_URL` defaults to
`http://127.0.0.1:4400`; use HTTPS for a remote backend.

The script calls `signup` from `snapback4/auth`, opens a separate
`createClient({ url, session })` for each returned session, and writes that
user's profile through `api.saveProfile`. Extend that block with your own
authorized mutations. It prints only email/principal mappings and signs out
each client; never print passwords or session tokens. You can sign in through
the app with those same accounts afterward. No browser signup or borrowed
starter token is needed.

For an existing seed set, run `SEED_AUTH=login node scripts/seed.mjs` with
the same password and count. Signup creates credentials, so duplicates refuse;
there is no automatic fallback on an arbitrary auth failure. A partially
completed first run leaves its accounts in place; reconcile those accounts
before rerunning. Sequential requests respect the concurrent Argon2 bound;
`serve` also rate-limits attempts (`E_RATE_LIMIT`). Stop and wait for that
window rather than retrying in a tight loop. `guide auth` explains the limits.
Replay adapters use this same session path; `snapback4 dev --replay` suppresses
new effects and holds schedules when replay must not deliver notifications.

`snapback/workers/notifications.mjs`: dev/serve supervise the worker and inject its token.
`ledger: true` records successful completions durably beside the backend store;
keep that file with backups. Add your provider call, passing
`meta.idempotencyKey`, then emit `notify` from your mutation or digest job.
The starter does not send or emit notifications until you connect it. Delivery
is at least once: provider idempotency covers a crash after the call but before
the ledger commit. `npx snapback4 doctor` shows worker state; `guide effects`
contains the provider and local log recipes. There is no separate worker launcher.
Workers execute private copies of `snapback/workers/`; keep relative helpers in
its subdirectories. `process.cwd()` starts at `SNAPBACK_PROJECT_DIR` (project
root in dev, active release root in serve). Write under that root's `data/`,
never relative to `import.meta.url`. Dependencies remain host-installed.
Arbitrary parent environment variables are stripped; declare/select needed secrets.

At every milestone, `npm run export:ios` publishes Hermes to `dist/` and returns.
Native proof runs in the background at background QoS, so you can keep building
without waiting for Xcode or the simulator. A newer export supersedes pending proof.
The next export and `npx snapback4 doctor` print its result; for your final report
run `npx snapback4 witness status --wait`. Receipts and logs stay in
`artifacts/native-smoke/<timestamp>`. Failures remain visible without failing a
successful export; unavailable native hosts report a skip.
Background preparation allows 900 seconds without output activity and at most 60 minutes total. Activity alone does not establish build progress; repeated output can keep a stalled build occupied until that cap.
`npm run native:smoke` explicitly waits for a full Release build and smoke.
Smoke proves acquisition, cold offline reopen and reconnect; an empty partition
proves lifecycle only. Pending write replay and application assertions need
`snapback4 guide witness`. Guest sign-in is the starter's normal auth flow.

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
SDK default: plain revalidation retains, possibly revoking change evidence bounds it; no cache holds
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
at server commit. Sends queue offline without predicted history rows. Receipts appear on each bubble, joined by ID from an independent page
chain with the same history bound and index. `usePendingWrites` shows outstanding sends and posts. Every send saves
its ID and complete arguments (including the attachment ID) in an account-
and backend-scoped intent journal before dispatch. Each saved ID observes its
own settlement; Edit restores a failed message, and Dismiss removes only the
UI reference. Unknown outcomes never trigger automatic resubmission.

For sends with application-supplied message IDs, use `usePendingItems` to render
row/intent arms across text and media, with explicit conversation and key mapping
(`snapback4 guide client`). The starter's automatically minted message keys must
not be guessed from mutation IDs: keep its scoped intent journal/receipt lookup
unless you add an explicit message-ID argument to the backend. The helper's
`settling` means “Sent; updating view”, not delivered or read. Media intent cards
never open assets. `usePendingState` selects repeated like/repost set-state intent
without changing the mutation or treating its pending value as observed data.

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
Receipt pages share that index and bound, with their own SDK cursor chain.

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
results” when `readPresentation(page.read).incomplete`, including nonempty present
answers with incomplete coverage, cuts or continuation. A complete page may still have more matches.
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

Search renders `readPresentation(page.read)` from `snapback4/contract`: incomplete
notices include nonempty pages with incomplete coverage, cuts or continuations.
`pending` means read loading, not a queued write. Freshness and revalidation have
separate labels. Keep the search input and conversation draft above results;
key screen state by backend/account/resource. `guide client` links a complete
React/Expo screen with this shell and a reusable read notice.

## Try a bounded observation screen

`src/BoundedConversation.tsx` and `src/PageLifetime.ts` are a complete smaller
alternative to the full Conversation screen. In PinnedConversation substitute
`<BoundedConversation backend={url} conversation={conversation} active={focused && foreground} />`
for ConversationScreen and use
`import { BoundedConversation } from "../../src/BoundedConversation"`.
The draft and send recovery stay outside the active route child; a refusal
restores text or offers Edit, even after backgrounding. Three requested 20-row pages
and a 20-ID window bound reads; Previous/Next rows moves the window. Each body's
point read owns its data, including withdrawal/expiry; a placeholder is evidence neither that the row exists nor that it does not. The shared root marker stores only an epoch/availability bit and
resets page depth/window/media selection at hard withdrawal, including backend
generation changes. Account/backend/client/argument changes clear the draft too.
`usePage` owns every cursor; no past body/cursor/asset metadata is retained.
The full Conversation retains the journal, receipts and richer UI. See
`guide social` for the full bounded source and `guide client` for the contract.

## Jump to a quoted message

Choose Reply on a bubble, type and Send. Only the original's ID is saved as
`replyTo`; previews come from `src/QuotedMessage.tsx`. Its `messagePhoto` point read returns
the whole message, even outside the loaded history page. `matchRead`
keeps a stable loading placeholder, renders present text, uses “unavailable” only
for proven absence, hides denied reads, and keeps partial empty reads uncertain.
It never caches a previous quote through withdrawal. `snapback4 guide social`
includes the same component; hold the point read in tests, then settle it.

Tap the excerpt to call `useJumpToMessage` through `QuotedMessage`'s `onJump`.
If the original is already visible it is highlighted in place. Otherwise the hook
scrolls to its index, opening `history({ conversation, through: ordinal })` if
needed: an indexed 20-row window ending at that ordinal, with identically bounded
receipt pages. Distance does not require an unbounded page-back loop. Online reads
can reach beyond the replica's 500-row horizon; offline reads use acquired history
and keep incomplete coverage uncertain. Latest messages restores the newest window.

The single variable-height `FlatList` uses `scrollToIndex` and
`onScrollToIndexFailed`: approach an unmeasured offset, then retry as cells mount,
for at most **four seconds**. Full visibility starts a **1.8-second** highlight;
failure shows a retry message. Absent/denied quotes have no jump action; loading,
partial and revalidating quotes never authorize a jump. Expiry in an extended
schema must flow through these live reads, never a saved excerpt or ordinal alone.
No read/window change replaces the composer, draft, reply selection or once viewer.
Browser tests seed an original, 30 messages and a reply, then check its actual
viewport rectangle and highlight within the four-second bound, plus a visible
original, unavailable original and draft preservation.

## Rendering read states

Use `matchRead` from `snapback4/react` or `snapback4/contract` on a query's read
or `page.read`. Supply `loading`, `denied`, `absent`, `partial` and `present`.
The last two receive `(data, read)`, with non-null data for `present`;
`denied` receives `(why, read)`, and `absent`/`loading` receive `read`.
Metadata stays available on ready reads. An explicit `otherwise(read)` can
replace loading/absent/present handlers; denial and partial emptiness always
need their own handlers. Status lines deliberately render nothing for absent
and present. Search also uses `readPresentation` for incomplete, stale and
revalidating notices; present does not imply complete. Keep the composer mounted
outside the match. The send matcher preserves the membership rule above.
