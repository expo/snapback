# Convex Messenger — build notes

A messaging demo (1-1 DMs, group chats, text, images, reactions,
WhatsApp-style reply quotes, typing indicators, seed data) built with Expo
Router (client) + Convex (backend). Lives at `demos/messaging-convex/`.

## What's here

- `convex/schema.ts` — users, conversations, conversationMembers, messages,
  reactions, typingIndicators.
- `convex/{users,conversations,messages,reactions,typing}.ts` — queries and
  mutations, including `messages.generateUploadUrl` for image upload via
  Convex file storage.
- `convex/seed.ts` + `convex/seedData.ts` + `convex/seedImageData.ts` — an
  action that seeds 6 users, 2 DMs, 2 group chats, and ~35 messages
  (including images, reactions, and replies) via base64-embedded placeholder
  PNGs. Idempotent — wipes and re-inserts on every run.
- `app/` — Expo Router screens: `login.tsx` (pick a seeded user, no real
  auth), `index.tsx` (conversation list), `conversation/[id].tsx` (message
  thread, composer, image picker, reactions, reply, typing).
- `lib/session-storage.ts` — uses `sessionStorage` (not `localStorage`) on
  web so two browser tabs can hold two different "logged in" identities,
  used to simulate a second client for verifying live sync.

## Verification performed

Ran `npx expo start --web`, drove it with Puppeteer against the real Convex
dev deployment (`clear-horse-558.convex.cloud`, no mocking). Confirmed:
login/user picker loads seeded users live; DM thread renders text, images,
grouped reactions, and quoted reply previews (verified from both
participants' independent sessions, so it's reading live shared state, not
local-only state); a message typed in one browser tab makes "X is
typing…" appear in the other tab's conversation view within ~1s, and
sending it makes the message appear on the other tab without a refresh;
group chat renders multiple senders with names/avatars per message run.
Screenshots are in `screenshots/`. Not verified: native iOS/Android (no
simulator driven in this pass — only web), and no automated test suite was
written (manual/scripted-browser verification only).

## What felt good

- **Schema + query + mutation model is very direct.** No separate
  resolvers/migrations ceremony — `defineSchema`/`defineTable`, then a
  `query`/`mutation` per file, and `npx convex dev` pushes and regenerates
  types continuously. Genuinely fast iteration loop.
- **Reactivity is free.** `useQuery` in the React client re-renders on any
  server-side data change with no manual subscription wiring — that's what
  makes the typing indicator and cross-tab message sync work with almost no
  client code (a `setTyping` mutation on keystroke + timeout, a
  `listTyping` query, done).
- **File storage is a two-liner.** `generateUploadUrl` mutation + `fetch`
  POST + `ctx.storage.getUrl()` in the read query. No separate bucket/CDN
  config for a demo like this.
- **Non-interactive project bootstrap worked**: `npx convex dev --once
  --configure new --team <slug> --project <slug>` created a real cloud dev
  deployment without a browser login flow, because an existing CLI access
  token was already on the machine — genuinely convenient for agentic
  workflows once auth exists.

## What felt bad / surprising

- **Convex object return values require ASCII-only field names.** I
  originally returned reactions grouped as `Record<Emoji, {count, ...}>`
  from the `messages.list` query. This throws a *runtime* error only when a
  client actually receives a row with an emoji reaction — `Field name ❤️
  has invalid character`. Not caught by `tsc`, not caught by `convex dev`'s
  push step, only surfaced when exercising the app for real. Had to switch
  to an array of `{emoji, count, userIds}` objects. This is a sharp edge
  worth knowing about before designing any schema/return-shape that uses
  free-form strings (usernames, emoji, tags) as object keys.
- **Node actions can't read bundled static files via `fs`/`__dirname`.**
  My first seed script tried to `fs.readFileSync` PNG assets from disk in
  a `"use node"` action; failed at runtime with `ENOENT` — the Convex
  bundler doesn't ship arbitrary non-JS files alongside the action bundle.
  Worked around it by base64-encoding the images into a `.ts` module and
  importing the strings directly. Fine for small seed assets, but a real
  gotcha if you assumed Node-action semantics matched a normal Node
  process.
- **Circular-type errors from `ctx.runMutation`/`ctx.runQuery` calls
  without explicit return-type annotations.** An action that calls another
  Convex function and returns its result needs `: Promise<...>` spelled out
  on the handler, or `tsc` reports `TS7022`/`TS7023` "implicitly has type
  any because it references itself" — a consequence of the generated
  `api`/`internal` types depending on the very file being typechecked. Not
  hard to fix once you know the pattern, but the error message doesn't
  point at the fix.
- **`npm install` peer-dep friction from Expo Router's own dependency
  tree** (`@expo/ui`/`vaul`/`@radix-ui` pulling in a React 19 peer range)
  forced `--legacy-peer-deps` for every install, unrelated to anything I
  added. Not a Convex issue, but part of the friction of the stack as a
  whole.

## Comparison to the Snapback build (informal)

Not compared directly (independent build, per instructions), but relative
to a typical React + Firebase/Supabase stack: Convex's query reactivity
removed the most tedious part of a chat app (message-list and
typing-indicator live updates) almost entirely — no listener setup,
no manual cache invalidation, no websocket plumbing on the client at all.
The tradeoff is the two sharp edges above (ASCII-only field names,
Node-action file access) that only show up once you push past
"CRUD tutorial" into real seed data and payloads with emoji/binary assets.
