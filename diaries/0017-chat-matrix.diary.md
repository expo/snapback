# 0017 — chat-matrix: a 2×4 AI chat matrix (Exact vs Expo × Snapback/Convex/Supabase/SQLite)

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
