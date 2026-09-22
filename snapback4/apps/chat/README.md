# Offline web chat starter

Create this Vite/React starter with `npx snapback4 init --web`. Default `init`
still writes only a schema. Run `npm install`, `npx snapback4 check`, then
`npx snapback4 dev` in one terminal and `npm run dev` in another. Development
personas use `?as=alice` (or bob/charlie); the account picker is development only.
The inbox starts empty; seed conversations and memberships through `POST /seed`
in development. A deployed app uses guest sessions and needs its own onboarding.

Build with `VITE_SNAPBACK_URL=https://your-backend npm run build`, then serve
`dist/` over HTTPS (localhost also works). This one supported output is a Vite
app with one generic `index.html` and hashed assets in `assets/`. For a subpath,
use `npm run build -- --base=/chat/` and serve at `/chat/`. Routes use
`/chat/#room=<conversation-id>`; no server rewrite is needed. Keep this entry
nonpersonalized. SSR, arbitrary navigation paths and other bundlers are outside
this starter's shell support. `shell.ts` only runs during production builds;
development does not install a worker. Use a separate origin for development
if you previously served a production build there.

The shell precaches only that build's immutable assets and generic entry with
credentials omitted. It never caches API responses, tokens, uploaded media or
arbitrary same-origin responses. A replacement worker waits until old tabs
close; those tabs keep their build's assets. Close all tabs to activate an
update. Browser storage eviction can remove offline availability.

`App.tsx` first reads the held conversation and membership. It does not create
a conversation or wait for a global `sync()` to open history. Unknown rooms
offline remain uncertain. Inbox/thread reads display incomplete and stale
states separately, and the header uses the SDK's durable `acquired` state.

`state.ts` saves route and write references under backend URL plus principal.
`Composer.tsx` saves a minted write ID before passing it to `client.mutate`;
on reopen `usePendingWrite(op, id)` observes its SDK receipt without submitting
again. `send` may predict a row. `markRead` writes an online-only marker and
queues without a predicted row. Unknown/evicted receipts remain unknown;
failed writes remain visible until dismissed. Dismissing a receipt never
cancels a write. Only the SDK owns outbox arguments and replay. Saved references
contain IDs and operation names, not message bodies; preserve a separate draft
if your product needs editable failed messages after a process restart.

This example explicitly uses `localStorageSessionStore()` for guest continuity
across page restarts. Any script executing on the origin can read that bearer
token; use this persistence only when that exposure is acceptable for your app.
Tokens never enter the service-worker cache. Sign-out removes local credentials
and closes the client even offline; remote revocation is best effort.
The completion screen waits for durable credential removal, and a storage
failure remains visible for retry. A late refresh cannot restore the session.
It hides the previous account immediately and preserves that account's replica,
outbox and receipt references. Account changes fence delayed UI callbacks.
Replace the guest/development entry with your product's existing sign-in flow.

Residency: conversations and memberships supply routing; messages supply the
thread with a 500-row horizon per conversation; messageCounts supplies inbox
counts. Profiles have a 2,000-row public horizon; readMarkers is server-only.
Use `snapback4 test --residency --fixture <directory> --as <principal>` on your
fixture before changing those horizons. Row counts do not measure client memory.
Verify your production build on a real device: acquire a room, close the page,
reopen offline, send twice, reopen again, and reconnect without duplicate rows.
The repository's `node witness/starter.mjs` exercises this actual production
output, receipt recovery, account changes and the shell update boundary.
