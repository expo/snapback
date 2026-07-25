# 0017 — chat-matrix: an AI chat matrix (8 UI stacks × Snapback/Convex/Supabase/SQLite)

## 2026-07-20 — Build diary

The product is deliberately small — pick an OpenRouter model, talk to it —
so the comparison surface is the interesting part: where the AI call lives,
how streaming reaches the UI, and whether the keyboard behaves. Verified
today: all four backends end-to-end headless; all four Expo cells on web with
send→reply driven in a real browser; Expo iOS on the simulator with the
software keyboard up and the composer avoiding it (sqlite and snapback
cells); Exact web cells for sqlite and supabase (the latter with visible
token streaming); the Exact macOS cell via Acto type/tap/tree evidence.

### Where the AI call lives turned out to be the sharpest comparison

- **Snapback** was the only backend where the AI call could live *inside the
  backend I authored*: `defineAction` + `fetch` + `ctx.runMutation`, with the
  key in write-only config (`/_snapback/api/config/set`) exposed to the
  handler as `ctx.secrets.rotating('openrouter').expose()`. That's a real
  differentiator — no extra process, no env-var custody question, and the
  guide's All Aboard demo was an exact template for the shape.
- **Convex** was nearly as integrated (`ctx.scheduler.runAfter` →
  internal action → `internalMutation` patches) and *more* capable on the
  wire: its default runtime supports response-body streaming, so the reply
  streams into the row in throttled patches. Deploy + `env set` + seed was a
  genuinely pleasant "go to lunch" workflow again.
- **Supabase and SQLite** have no in-backend function runtime here, so the
  gateway grew an AI worker that claims `pending` assistant rows and patches
  deltas in. Fine — but now a second process is part of the product.

The asymmetry that matters: **the Ibex action runtime has no
`ReadableStream`**, so the Snapback reply lands as one commit while Convex/
Supabase/SQLite stream token deltas. I first wrote the streaming path
optimistically; zero intermediate commits appeared, and a grep of vendor/ibex
confirmed no ReadableStream exists anywhere. The diary's earlier partiful
notes called out the missing streaming/token-append pattern; an AI chat demo
makes that gap load-bearing rather than theoretical. (Guide-gap to file per
LLP 0061 §5 once a Linear session is authenticated: "streaming/token-append
AI-reply pattern for actions — no guide page, no ReadableStream in the
runtime, wall-clock watchdog implications undocumented.")
*(Update 2026-07-24: closed. LLP 0076 landed `ctx.fetchStream` and this
demo's Snapback cell now streams — see the 2026-07-24 entry below. The
guide gap is ENG-25423.)*

### Snapback authoring notes

- Codegen fails closed with excellent codes, and two of them taught me the
  sandbox model in five minutes: `BUNDLE_UNSUPPORTED_FETCH` until
  `SNAPBACK_OUTBOUND_ACTIONS=1` is set *at codegen time*, and
  `BUNDLE_UNSUPPORTED_TIME` for ambient `Date` (runtime time comes from
  `ctx.runtime.now()`). I like that the analyzer runs at authoring time, not
  first-request time.
- `ctx.db.get('table', id)` — the table name comes first, unlike Convex's
  document-id style. I wrote the Convex shape from muscle memory and got
  `SNAPBACK_HANDLER_HOST_CALL_INVALID` with no hint about which call or why.
  The diagnostic told me *that* a host call was invalid, not *which argument
  shape* was wrong; the todo demo's handlers were the actual documentation.
- Actions can't read (`ctx.db` absent), so "claim a pending row and give me
  the history" became a mutation that both claims and returns the snapshot —
  the claim barrier doubles as the read. Once seen, it's a clean pattern;
  nothing in the guide names it.
- The generated `contract-data.manifest.json` + `contract/` bindings appear
  for free from codegen — the Exact-provider seam exists even though this
  demo's Exact cells went through the gateway instead.

### The RN/Expo gap is smaller than the roadmap fears — for Online class

LLP 0063 WS2 treats React Native/Expo as unproven. Empirically today:
`@snapback/client` imported into an Expo SDK 57 app via Metro `watchFolders`
worked on the first try on web *and* on the iOS simulator, including
`transport: 'stream'` — the WebSocket live query connected and the `push`
badge lit up on-device. Nothing about the client assumed DOM. The honest
qualifier: this is Online-class usage (no local replica, no outbox); the
local-first story remains unbuilt, exactly as LLP 0012 requires it to be
declared.

### Keyboard handling: Expo delivered, Exact is still growing into it

- Expo Go bundles `react-native-keyboard-controller`; wrapping the screen in
  its `KeyboardAvoidingView` (behavior "padding") plus an inverted `FlatList`
  and `keyboardDismissMode="interactive"` produced the behavior I wanted with
  ~40 lines: composer rides the keyboard animation, list stays pinned,
  nothing jumps. Screenshots retain the evidence (composer directly atop the
  keyboard, message list clear of it).
- The Exact side has runtime-managed keyboard avoidance
  (`keyboard-avoidance.ts` scrolls the focused input into view) rather than
  an authoring-level primitive; its own composer-keyboard experiment report
  says real native keyboard tracking isn't implemented. On macOS this is
  moot; the iOS-host verification is the open item here, and a docked
  composer above the keyboard (the chat pattern) has no first-class
  expression like `inputAccessoryView` or `KeyboardStickyView` yet.
- No stick-to-bottom primitive on the Contract `virtualList` (the
  `scrollToEnd` convenience lives only in the React list tier). I used a
  plain `scroll` and let content growth handle it, which is fine at demo
  scale but wouldn't be at product scale.

### Exact + Contract observations

- Authoring the chat screen as one `.contract` file was genuinely fast, and
  the compiler's discipline (every action declares its writes; interactive
  nodes need labels/testIds) reads like acceptance-first design. The
  `contract` block then *is* the Acto checklist.
- Contract actions can't consume a mutation's return value into state, so
  "create conversation on first send, then use its id" cannot live in the
  view layer. I moved conversation identity into the provider (send lazily
  creates; setModel/newConversation reset), projected back through a
  `chatInfo` query. It works and arguably lands at the right altitude — but
  the framework forced the design, and nothing documents the pattern.
- Acto over plain HTTP was excellent once two undocumented-in-context facts
  were found: mutating operations need `Authorization: Bearer
  $EXACT_AGENT_TOKEN` even on loopback (good policy — but the dev server
  mints no visible token; I had to grep tests to learn the env var), and
  `/agent/tree` is GET where most operations are POST. Type → tap → tree
  diff then verified the macOS cell end to end, and the supabase Exact web
  cell showed real mid-generation streaming through a 600 ms poll.
- The agent `screenshot` endpoint returned a blank PNG in this headless
  session while the tree was fully populated — semantic evidence beat pixels,
  which is rather the Acto thesis.
- Friction: `bun run typecheck` fails on the app template today from
  *upstream* drift — the route-registry generator emits `agentCapabilities`
  that the linked `@exact/router`'s `ContractRouteMeta` type doesn't accept,
  plus assorted strict-mode errors inside linked packages. Vite dev/build
  don't care, but a fresh app failing typecheck out of the gate on checkout
  HEAD is the kind of thing that erodes trust in the loop.
- `exact.links.json` uses paths relative to the app's canonical location,
  which breaks in git worktrees; I added an `EXACT_ROOT` env override to the
  scaffold's `link-exact.mjs` copy. Worth upstreaming.
- No iOS prebuilt host exists yet (ENG-23311 tracks it): `exact run ios`
  requires a locally built simulator ExactApp, a real first-time toll
  (fresh `xcodebuild` of the Rust kernel + host).

### Convex/Supabase deployment-shape notes

- The deployment-scoped Convex deploy key plus wholesale-codebase deploys
  forced the chat codebase to *contain* partiful-matrix's modules verbatim —
  deploying either demo's dir alone would delete the other's functions. That
  unification pressure is a real property of the platform worth naming in
  any comparison: schema and functions are deployment-global.
- Supabase table creation over direct Postgres again defaulted to RLS-off
  with full anon grants; hardening is now part of the adapter's bootstrap
  DDL rather than an afterthought (lesson inherited from the partiful
  supabase-realtime work, applied by construction this time).

### Environment traps recorded for the fleet

- A fresh worktree bootstrap that installs prepared Hermes artifacts from
  the **sibling ibex checkout** produced a server where every JS handler
  died with `SNAPBACK_RUNTIME_CREATE_FAILED` (Hermes VM creation returns
  null; `ibex-doctor` reports healthy; the launch smoke passes). Replacing
  `vendor/ibex/ios/Frameworks` with the main checkout's artifact set fixed
  it. The doctor validates presence, not VM-creatability — a gap worth a
  coded check.
- `create-expo-app` left waiting on its interactive git prompt cleans up its
  tracked files when killed — which silently deleted the scaffold out from
  under me while my own added files survived. `CI=1` makes it
  non-interactive.
- The fixed-port trap again, Exact edition: another session's Exact dev
  server held :8083; mine silently bound :8084 while my probe hit the
  stranger on :8083. The servedApps list in the bootstrap HTML was the tell.

### Verdict snapshots (subjective, after one build day)

- Fastest cell to a working AI chat: **Convex** (schema+functions+action in
  one file, streaming included).
- Most self-contained story: **Snapback** (the backend owns the AI call and
  the key; one binary + one codegen; loses on streaming).
- Most familiar data model: Supabase/Postgres again — but everything
  interesting (worker, hardening, realtime wiring) lived outside it.
- Expo × anything beat Exact × anything on time-to-polished-keyboard today;
  Exact's counterweight is the contract block + Acto making verification a
  first-class artifact rather than a scraped DOM.

## 2026-07-20 (later) — expanding to 8 stacks: SwiftUI, Flutter, React web, and three TUIs

The matrix grew the same afternoon: SwiftUI (iOS + macOS), Flutter (iOS +
web), a plain React web baseline, and three terminal UIs (Ratatui, Ink, and
the Exact TUI target). All non-Expo cells go through the gateway's `/rpc`
poll surface, so each new stack is a pure UI-authoring comparison. Every app
now states its stack in the UI ("built with …") per request.

### SwiftUI — the smoothest native cell of the day

- `xcodegen` + `project.yml` patterned on partiful-matrix's SwiftUI cell:
  both iOS and macOS targets **built on the first try**, and the app worked
  on the first launch (snapback cell verified on-simulator, sqlite cell on
  macOS, supabase after the badge rebuild — all via the gateway).
- Keyboard avoidance cost **zero lines**: the composer sits in
  `safeAreaInset(edge: .bottom)` and iOS moves the safe area with the
  keyboard. Screenshot shows the composer riding directly atop the keyboard —
  the thing Expo needed react-native-keyboard-controller for and Exact
  hasn't built yet is simply the SwiftUI default.
- `simctl launch` env delivery (`SIMCTL_CHILD_*`) works exactly as documented
  — ProcessInfo sees the vars. Worth noting because Flutter's doesn't (below).
- Whole app: ~500 lines of Swift across 5 files, no dependencies.

### Flutter — solid, with one real environment trap

- `flutter create` + one `main.dart` (~450 lines); `flutter analyze` clean on
  the second pass. Web needs a conditional import (`dart:io` is a compile
  error on web) — the `env_stub.dart if (dart.library.io) env_io.dart`
  incantation is arcane but standard.
- **Trap: `Platform.environment` on iOS does not see simctl-delivered env.**
  `ps eww` shows `CHAT_AUTODEMO=1` on the Runner process, but Dart reports it
  absent — so `SIMCTL_CHILD_*` hooks silently no-op. The portable hooks are
  `--dart-define` at build time (native) and `Uri.base.queryParameters` (web).
  Cost me three rebuild-relaunch cycles to isolate.
- Keyboard: Scaffold's default `resizeToAvoidBottomInset` just works; the
  composer tracks the keyboard with no extra code. Between SwiftUI, Flutter,
  and Expo+keyboard-controller, keyboard avoidance is a solved problem
  everywhere except Exact's native hosts.
- Flutter web renders to canvas, so the CDP innerText probe used on every
  other web cell is blind — verification fell back to screenshot plus
  gateway side-effect. Fine for acceptance, but semantic-tree-based tooling
  (the Acto thesis again) has nothing to grab.
- iOS convex cell and web supabase cell verified end-to-end.

### React web — the baseline earns its name

Vite + React DOM + fetch/poll: 69 packages, typecheck clean, **verified
end-to-end on the first browser load** (snapback cell, full reply). Fastest
cell of the entire matrix to working. This is the reference point every
richer stack should justify itself against.

### Ratatui and Ink — terminals were easier than expected

- Both TUIs completed the full AI loop on their first tmux run (Ratatui on
  convex, Ink on snapback), including the streaming caret rendering.
- **Ratatui** (~460 lines Rust): the mpsc worker-thread pattern (UI thread
  never touches HTTP) fell out naturally; blocking reqwest on the worker,
  60ms event poll on the UI thread. Most of the line count is layout/drawing
  — the framework gives you nothing for free, but nothing fights you either.
- **Ink** (~230 lines): the React mental model transfers wholesale — the
  providers/hooks shape from the web baseline ported almost line-for-line
  (`useEffect` + `setInterval` poll, `useInput` for keys). Bun runs the TSX
  entry directly, no build step. Shortest path from "web React dev" to
  "working TUI" by far.
- Both got an `--autodemo` flag that sends a scripted message, exits when the
  assistant reply completes, and prints the transcript — which makes TUI
  acceptance a plain exit-code + stdout check, no pane-scraping needed.

### Exact TUI — a real target with a real (intentional) boundary

- Exact ships a TUI arm (LLP 0368): `exact-tui.json` manifest + a `.contract`
  entry over `@exact/tui-contract` components (Screen/Panel/Log/Tabs/
  StatusBar + patterns). Authoring the chat UI was genuinely pleasant and the
  compiler caught my mistakes (TextField has no `submit` prop; the raw
  `input` node does — same discipline as the GUI contract).
- `exact run tui` compiled my app to a 973KB HBC on the first try, from a
  project **outside** the exact repo. Two caveats: `exact contract meta`
  (sidecar generation) must run from inside an Exact checkout
  (exact-verify.json discovery), and the CLI help still says `macos` is the
  only `run` platform — the README/RFC are ahead of the help text.
- **The cell is offline by design**: the TUI runtime has no network host
  call, so this chat app cannot reach the gateway. The cell renders the real
  UI with a scripted reply that states the boundary. That's the honest
  comparison row: 7 of 8 stacks can be an AI chat client today; the Exact
  TUI target can't yet, by explicit LLP 0368 scoping.
- Launching the host hit fleet drift: the exact checkout's vendored macOS
  Hermes slice is currently missing (host rebuild panics in ibex build.rs;
  `HERMES_LIB_DIR` pointed at snapback's slice is the workaround), and the
  prebuilt `exact-host-tui` from this morning exits 1 silently — even for
  the repo's own tui-blackjack example — so the launch failure is
  environmental, not app-side.

### ExactApp iOS host — still blocked upstream, now differently

The first-time simulator build of ExactApp failed at the asset-catalog stage
(`HDRFixtures.xcassets` has no `AppIcon` set — worked around with
`ASSETCATALOG_COMPILER_APPICON_NAME=`), and the retry then failed at
`ExactRuntimeShell.swift:4790: cannot find 'nativeHostIdentity' in scope` —
the shared checkout drifted mid-build under concurrent fleet sessions. The
Exact × iOS cell stays app-ready but host-blocked (ENG-23311 territory plus
local checkout churn).

### Round three: Bubble Tea, Textual, OpenTUI

Three more terminal stacks, same product, same gateway. All three completed
the AI loop on their first real run — at this point the portable `/rpc`
surface has made new cells almost mechanical.

- **Bubble Tea** (Go, ~430 lines): the Elm architecture is the strictest
  model of the three — all effects live in `tea.Cmd` closures returning typed
  messages, so the HTTP/poll wiring is more ceremony than Ink's
  `useEffect`+`setInterval` but is impossible to get subtly wrong. Go compiled
  clean on the first `go build`. Lip Gloss styling is pleasant. The toolchain
  wasn't installed (`brew install go`) — heaviest setup of the TUI row.
- **Textual** (Python, ~230 lines): the "web dev for terminals" pitch is
  real — CSS stylesheet in the app class, widgets with ids, `set_interval`
  polling, and it **rendered the assistant's markdown reply with headings
  and bullets without being asked**. uv's PEP 723 script header made the
  whole environment (`uv run chat.py`) a non-event: 16 packages in 15ms.
  One convention difference: Tab moves focus in Textual, so backend cycling
  lives on Ctrl-B here.
- **OpenTUI** (React/TS, ~230 lines): API discovered entirely from the
  package README in node_modules — `<box>/<text>/<input>` JSX, `useKeyboard`,
  flexbox-style props. Closest sibling to Ink; younger (`<input>` has no
  controlled-clear, I remounted it with a key to clear the composer), but the
  renderer felt fast and the styling model (nested `<span>` with fg/bg) is
  nicer than Ink's for inline color.
- Comparative feel across the five networked TUIs: Ink and OpenTUI are the
  shortest path for anyone who knows React; Textual is the most batteries-
  included (markdown, CSS, focus system); Bubble Tea is the most disciplined;
  Ratatui is the most manual but the most predictable. All five support the
  same `--autodemo` exit-with-transcript acceptance hook now.

### Updated verdict snapshots

- Time-to-working-cell, fastest first: **React web**, **Ink**, **SwiftUI**,
  **Flutter**, **Ratatui**, Expo (counting its earlier keyboard tuning),
  Exact GUI, Exact TUI (blocked at the finish line).
- Keyboard avoidance for free: SwiftUI and Flutter. Expo needed one library.
  Exact still needs the primitive.
- The gateway-poll architecture paid for itself today: four new stacks and
  not one backend-specific line had to be written in any of them.

## 2026-07-24 — the Snapback cell learns to stream (LLP 0076 adoption)

LLP 0076 (bounded streamed actions) landed on main yesterday and today, so I
became its first demo consumer: `generateReply` now uses `ctx.fetchStream` on
OpenRouter's SSE and commits throttled token deltas through
`applyAssistantDelta`. The asymmetry this diary recorded on day one — Snapback
replies landing as one commit while Convex streamed — is gone. Witnessed via a
150 ms poll during generation: six distinct `streaming` snapshots with content
growing 101 → 658 chars before `complete`.

What adoption felt like:

- **The diff was small because the shape was already right.** The
  claim-and-return mutation, the pending→streaming→complete row lifecycle, and
  the commit-through-mutation plumbing all survived unchanged; only the fetch
  body swapped for a reader loop plus ~40 lines of byte-level SSE parsing
  (split on `\n` before UTF-8 decode — continuation bytes are never 0x0A, so
  multibyte tokens survive chunk boundaries; the Ibex runtime has no
  `TextDecoder`).
- **Capability declaration is free.** Codegen's AST scan noticed
  `ctx.fetchStream` in the handler and added `bounded_response_stream_v1` to
  the action's `requiredCapabilities` on regen — nothing to declare by hand,
  and a server without the capability refuses the artifact at admission
  instead of failing mid-reply.
- **The progress-rate fence bit me immediately, and the diagnostic paid for
  itself.** My first throttle (commit every 2 reads) blew the
  ten-commits-per-second limit ~1.2 s in; the reply row itself carried
  `SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED: stream progress exceeds ten
  authoritative commits per second`, which named both the rule and the fix.
  Actions have no wall clock by design, and the platform's answer is built
  into the reader: `read()` returns trusted `elapsedMs`/`deltaMs`, so pacing
  commits at ≥200 ms spacing took three lines. That is the right shape for a
  deterministic runtime — I never missed `Date.now()`.
- **Boundedness is a designable contract, not a surprise.** 1 MiB total, 30 s
  wall, 5 s idle are real ceilings a chat demo can hit on long replies; the
  handler maps the three stream-limit codes to an honest "(truncated: …)"
  completion when tokens are already in hand, which is strictly better than
  the pre-streaming behavior (all-or-nothing).
- Local secret handling stayed idiomatic: value-mode `asBearer()` in the
  header works exactly like ordinary `fetch`, with the staged-value redactor
  covering error envelopes. (Descriptor slots are the hosted-profile story.)

Scoreboard effect: the "where the AI call lives" comparison now has Snapback
and Convex in the same class — backend-owned streaming over the ordinary
live-fan-out — with the gateway worker (Supabase/SQLite) as the only
non-backend streamer left. Every TUI's blinking `▍` cursor on the snapback
backend now shows real token growth instead of a long busy state.
