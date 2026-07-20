# chat-matrix

One product — pick an OpenRouter model, have a conversation with an AI —
authored across **eleven UI stacks** and run over **four backends** (Snapback,
Convex, Supabase, SQLite). The assistant reply streams into the message row
server-side and each backend's own realtime mechanism (or a poll) delivers it.
Every app states its authoring stack in the UI ("built with …").

| authoring \ backend | Snapback | Convex | Supabase | SQLite |
| --- | --- | --- | --- | --- |
| **Expo** (iOS + web) | `@snapback/client` live query (WebSocket push) | `ConvexClient` subscription (push) | `supabase-js` + Realtime (push) | gateway HTTP + 700 ms poll |
| **Exact + Contract** (macOS, iOS, web) | gateway poll | gateway poll | gateway poll | gateway poll |
| **SwiftUI** (iOS + macOS) | gateway poll | gateway poll | gateway poll | gateway poll |
| **Flutter** (iOS + web) | gateway poll | gateway poll | gateway poll | gateway poll |
| **React web** (baseline) | gateway poll | gateway poll | gateway poll | gateway poll |
| **Ratatui** (terminal, Rust) | gateway poll | gateway poll | gateway poll | gateway poll |
| **Ink** (terminal, React) | gateway poll | gateway poll | gateway poll | gateway poll |
| **Bubble Tea** (terminal, Go) | gateway poll | gateway poll | gateway poll | gateway poll |
| **Textual** (terminal, Python) | gateway poll | gateway poll | gateway poll | gateway poll |
| **OpenTUI** (terminal, React/TS) | gateway poll | gateway poll | gateway poll | gateway poll |
| **Exact TUI** (terminal, Contract) | — offline by design — | — | — | — |

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

# SwiftUI app (iOS simulator + macOS)
cd demos/chat-matrix/swiftui
xcodegen generate    # after editing project.yml; the xcodeproj is committed
xcodebuild -project ChatMatrixSwiftUI.xcodeproj -scheme ChatMatrixSwiftUI-iOS \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath .build build
xcrun simctl install booted .build/Build/Products/Debug-iphonesimulator/ChatMatrixSwiftUI.app
xcrun simctl launch booted dev.snapback.chatmatrix.swiftui.ios
# env hooks: SIMCTL_CHILD_CHAT_AUTODEMO=1, SIMCTL_CHILD_CHAT_BACKEND=<backend>

# Flutter app (iOS simulator + web)
cd demos/chat-matrix/flutter
flutter build ios --simulator --debug && xcrun simctl install booted build/ios/iphonesimulator/Runner.app
flutter build web && python3 -m http.server 5480 --directory build/web
# hooks: --dart-define=AUTODEMO=1 / CHAT_BACKEND=... (native); ?autodemo=1&backend=... (web)

# React web baseline
cd demos/chat-matrix/react && bun install && bun run dev   # http://127.0.0.1:5470
# hooks: ?autodemo=1&backend=<backend>&gateway=<origin>

# Ratatui TUI
cd demos/chat-matrix/ratatui && cargo run -- --backend convex
# keys: Enter send · Tab backend · Ctrl-P model · Ctrl-N new chat · Ctrl-C quit
# hooks: --autodemo (sends one scripted message, exits after the reply, prints transcript)

# Ink TUI
cd demos/chat-matrix/ink && bun install && bun run cli.tsx --backend snapback
# same keys and --autodemo hook as the Ratatui cell

# Bubble Tea TUI (Go)
cd demos/chat-matrix/bubbletea && go run . --backend sqlite

# Textual TUI (Python; uv resolves deps from the script header)
cd demos/chat-matrix/textual && uv run chat.py --backend convex
# Ctrl-B cycles backends here (Tab moves focus in Textual)

# OpenTUI TUI (React/TS)
cd demos/chat-matrix/opentui && bun install && bun run cli.tsx --backend supabase

# Exact TUI (offline cell — see boundary note below)
cd demos/chat-matrix/exact-tui && exact run tui
```

The Expo, SwiftUI, Flutter, React, Ratatui, and Ink apps switch backends at
runtime; the Exact GUI app selects its backend at dev-server start
(`CHAT_BACKEND`), matching the partiful-matrix cell convention.

Autodemo hooks (`EXPO_PUBLIC_AUTODEMO=1`, `SIMCTL_CHILD_CHAT_AUTODEMO=1`,
`--dart-define=AUTODEMO=1`, `?autodemo=1`, `--autodemo`) make each app focus
the composer and send one scripted message shortly after boot — the hook
headless acceptance uses to drive the full loop, including keyboard-avoidance
screenshots, without synthetic taps.

## Honest boundaries

- The Exact, SwiftUI, Flutter, React, Ratatui, and Ink cells reach every
  backend through the gateway's portable `/rpc` poll surface (like
  partiful-matrix's Apple cells); they do not use provider-native clients or
  push. The Expo cells are the idiomatic-client comparison.
- **The Exact TUI cell is offline by design.** LLP 0368 gives the TUI runtime
  no network host call, so `exact-tui/` renders the real chat UI (tabs, log,
  composer) with a scripted local reply that states the boundary. Its contract
  compiles to an HBC via `exact run tui`; launching the host currently also
  depends on the exact checkout's vendored macOS Hermes slice being present.
- The Convex codebase here (`convex/`) **contains partiful-matrix's modules
  verbatim**: both demos share one Convex deployment and `npx convex deploy`
  pushes a whole codebase, so deploying either demo's dir alone would delete
  the other's functions. Deploy from this dir (it carries the union) and see
  `convex/convex/events.ts`'s header before touching either.
- Supabase chat tables (`chat_matrix_*`) are created RLS-hardened by the
  gateway adapter: anon may read and insert, never update/delete/truncate;
  assistant rows are patched only by the owner-connected AI worker.
- `keyboard engine: keyboard-controller` is the verified iOS path for Expo
  (react-native-keyboard-controller inside Expo Go); SwiftUI keyboard
  avoidance is framework-native (`safeAreaInset`); Flutter's rides Scaffold's
  `resizeToAvoidBottomInset`; web and stripped hosts fall back to
  RN's `KeyboardAvoidingView` / plain flex.
- Flutter iOS ignores `SIMCTL_CHILD_*` runtime env (`Platform.environment`
  does not see it even though `ps eww` shows it on the process) — use
  `--dart-define` at build time instead.
