# chat-matrix

A 2×4 matrix of AI chat apps: **Exact + Contract** vs **Expo (React Native)**
across **Snapback, Convex, Supabase, and SQLite**. One product: pick an
OpenRouter model, have a conversation; the assistant reply streams into the
message row server-side and each backend's own realtime mechanism delivers it.

| authoring \ backend | Snapback | Convex | Supabase | SQLite |
| --- | --- | --- | --- | --- |
| Expo (iOS + web) | `@snapback/client` live query (WebSocket push) | `ConvexClient` subscription (push) | `supabase-js` + Realtime (push) | gateway HTTP + 700 ms poll |
| Exact + Contract (macOS, iOS, web) | gateway poll | gateway poll | gateway poll | gateway poll |

Where the AI call lives is part of the comparison:

- **Snapback** — a `defineAction` with `fetch` inside the backend
  (`SNAPBACK_OUTBOUND_ACTIONS=1`), committing through mutations. The Ibex
  runtime has no `ReadableStream`, so the reply lands as **one commit** —
  a recorded authoring gap vs the streaming columns.
- **Convex** — `sendMessage` schedules an internal action; the action streams
  OpenRouter tokens and commits throttled `applyDelta` patches.
- **Supabase / SQLite** — no server function runtime of their own; the
  gateway's AI worker claims `pending` assistant rows and streams deltas in.

The OpenRouter key is never in any client bundle: it lives in the gateway
process, the Convex deployment env, and Snapback's write-only config
(`/_snapback/api/config/set`). Clients see only public values (gateway origin,
Convex URL, the Supabase *publishable* key).

## Running it

```sh
# terminal 1 — snapback server + gateway (+ AI worker); reads the OpenRouter
# key from OPENROUTER_API_KEY or ~/Dropbox/APIKeys/openrouter.txt
bun demos/chat-matrix/dev.mjs

# once per deployment: deploy Convex (union codebase, see below) + set its key
cd demos/chat-matrix/convex && bun run setup

# Expo app (iOS simulator + web)
cd demos/chat-matrix/expo
bun run env        # writes .env (public values only) from local secrets
npx expo start     # then open in Expo Go / press w for web

# Exact app (macOS / iOS / web); backend per dev-server via CHAT_BACKEND
cd demos/chat-matrix/exact
EXACT_ROOT=~/projects/exact bun install
CHAT_BACKEND=supabase EXACT_AGENT_TOKEN=dev bun run dev   # web on :8083+
exact run macos --url http://127.0.0.1:<port>
exact run ios   --url http://127.0.0.1:<port>
```

The Expo app switches backends at runtime (chips in the header); the Exact
app selects its backend at dev-server start (`CHAT_BACKEND`), matching the
partiful-matrix cell convention.

`EXPO_PUBLIC_AUTODEMO=1` (with optional `EXPO_PUBLIC_INITIAL_BACKEND`) makes
the Expo app focus the composer and send one scripted message two seconds
after boot — the hook headless acceptance uses to drive the full on-device
loop, including keyboard-avoidance screenshots, without synthetic taps.

## Honest boundaries

- The Exact cells reach every backend through the gateway's portable `/rpc`
  poll surface (like partiful-matrix's Apple cells); they do not use
  provider-native clients or push. The Expo cells are the idiomatic-client
  comparison.
- The Convex codebase here (`convex/`) **contains partiful-matrix's modules
  verbatim**: both demos share one Convex deployment and `npx convex deploy`
  pushes a whole codebase, so deploying either demo's dir alone would delete
  the other's functions. Deploy from this dir (it carries the union) and see
  `convex/convex/events.ts`'s header before touching either.
- Supabase chat tables (`chat_matrix_*`) are created RLS-hardened by the
  gateway adapter: anon may read and insert, never update/delete/truncate;
  assistant rows are patched only by the owner-connected AI worker.
- `keyboard engine: keyboard-controller` is the verified iOS path
  (react-native-keyboard-controller inside Expo Go); web and stripped hosts
  fall back to RN's `KeyboardAvoidingView` / plain flex.
