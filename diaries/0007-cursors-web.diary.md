# Diary 0007: Web cursor presence

**Demo:** Web cursor presence (`demos/cursors-web/`)
**Surfaces:** contract (required; the web arm was deleted 2026-07-02 — see the ENG-22524 entry below)
**Author:** Codex (2026-06-28); Claude (Fable 5) (2026-07-02 entry); Claude (Opus 4.8) (2026-07-04 entry)
**Date:** 2026-06-28
**Related:** LLP 0013, LLP 0015, LLP 0016, LLP 0020, LLP 0025, LLP 0034, Diary 0006, Exact LLP 0281/0284/0264, ENG-22524, ENG-22797, ENG-22564, ENG-22480

## 2026-06-28 - Building the LLP 0025 reset

### What I built

I replaced the abandoned graffiti-board scope with a web-only cursor presence
fixture:

- source-authored `webCursors` ephemeral collection with `roomId` scope,
  connection-owned keys, 5s TTL, allow-all local auth, and latest WebSocket
  delivery;
- a plain DOM page under `demos/cursors-web/surfaces/web/` that tracks pointer
  coordinates, publishes fractional viewport positions, and renders connected
  clients as colored cursor labels;
- generated `api.mjs` and `schema.manifest.json` as the page's Snapback contract;
- a dependency-free Chrome DevTools Protocol acceptance test that opens two
  browser contexts, moves real mouse coordinates, and checks both DOM overlays.

### Snapback changes

The important core change was not the page. `LocalEphemeralBackend` now has an
idempotent `ensure_collections` path, and `replace_collections` preserves rooms
and outboxes when the loaded collection definitions are exactly unchanged.
`/ephemeral/collections/ensure` exposes that as the browser bootstrap check.

That directly fixes the Diary 0006 failure where a second tab called schema load
and cleared the first tab's room. The page now assumes app definitions were
loaded by the runner, then verifies the generated collection definitions without
re-provisioning the server.

I also wired WebSocket close to `disconnect`, so connection-owned cursor entries
are removed promptly when a tab closes. TTL is still the backstop, but the normal
two-tab demo no longer waits for expiry to make a departed cursor disappear.

### Glue inventory

| Bridge file | Role |
|-------------|------|
| `demos/_kit/client.mjs` | Adds `ensureEphemeralCollections`; existing WebSocket helper is reused |
| `demos/cursors-web/surfaces/web/main.mjs` | DOM pointer capture, WebSocket envelopes, overlay render |
| `demos/cursors-web/tests/acceptance/browser.mjs` | CDP harness in place of Playwright dependency |

The page still manually sends the current v0 WebSocket envelopes
(`ephemeral_subscribe`, `ephemeral_publish`, `ephemeral_delete`). That should move
behind generated or package-owned helpers, but at least the room key and
permission encoding are not handwritten in the demo.

### What felt good

- The generated ephemeral reference was enough for the page to avoid naming
  collection internals by convention.
- The existing `EphemeralOverlay` worked for browser state once the WebSocket
  message shapes were applied.
- CDP kept the acceptance test dependency-free and closer to the actual browser
  behavior than a headless-only mock.
- The durable/ephemeral boundary is now easy to assert: after cursor movement,
  durable storage version remains `0` while `inspect.ephemeral` shows one room.

### What felt bad

- The client API still exposes wire envelopes too directly for browser authors.
  Convex-style presence would hide subscribe/publish request IDs, stream acks,
  and byte encoding behind a hook or generated helper.
- There is no packaged static-web dev command yet. The acceptance test provides
  its own tiny static server.
- Allow-all auth is right for this v0 fixture but too weak to copy into a real
  shared document demo.

### Compared to Convex or Supabase

React plus Convex would be quicker for a cursor room because the presence hook
and browser client are product surfaces already. Supabase channels would also be
less code for a two-tab pointer demo. Snapback's win here is stronger lifecycle
and modeling clarity: schema reload, stale collection definitions, durable
version, rate limits, and room diagnostics are all structured server facts rather
than comments in demo glue.

### Net

This is the smaller proof LLP 0025 asked for. It does not claim drawing, native,
Contract, offline presence, or hosted adapter support. It does prove that the
local Snapback ephemeral lane can hold cursor presence without writing durable
rows, and that browser page load no longer has to destroy active rooms to verify
generated collection definitions.

## 2026-07-02 — The imperative arm deletes: pure Contract on LLP 0281 stage 0 (ENG-22524)

**Author:** Claude (Fable 5), agent-authored
**Related:** Exact LLP 0281 (stage 0, rev 2 §3.1 + §7 ImplNotes), Exact LLP 0284 §5 item 4, LLP 0034, ENG-22479, ENG-22516, ENG-22524, ENG-22463
**Exact pin:** `253a39eb` (the stage-0 revision this surface verified against)

### What changed

Exact LLP 0281 stage 0 landed (pointer event attrs, host-owned value
channels, rated `publish` — no new grammar), so this demo became the proof
it was budgeted for. The whole imperative arm is gone:

- `surfaces/web/main.mjs` (307 lines: pointer capture, envelope glue, the
  hand throttle, the DOM-diff overlay), `index.html` (17), `style.css`
  (120) — **444 lines of framework-free surface deleted**.
- `tests/acceptance/browser.mjs` (396 lines, the LLP 0025 imperative CDP
  acceptance) — deleted; the Contract acceptance is the required runner
  now (hardened to the ENG-22486 bar: `runAcceptance` + `expectedChecks: 6`).
- The Contract mount shim's write-side glue — the `document.addEventListener('pointermove', ...)`
  + 66ms hand throttle + `webCursorsPublish(...)` call — deleted. `main.ts`
  is pure bootstrap now (client health, D4 ensure, surface creation,
  mount with identity props, test facts).

The write side lives IN the `.contract` file:

```contract
use pointer = pointerChannel({ publish: webCursorsPublish, rate: 15, payload: { roomId: "lobby", value: { x: Math.round(sample.x), y: Math.round(sample.y), name: profileName, color: profileColor } } })
...
stack ... pointermove=pointer.self testId="cursor-stage"
...
column ... opacity=pointer.self.hasSample ? 0.9 : 0 transform=`translate(${pointer.self.x - 8}px, ${pointer.self.y - 8}px)` testId="self-dot"
```

`pointermove` binds only the channel (the Exact analyzer rejects a
transactional action there); the channel is frame-coalesced and never
enters the signal graph; the self dot renders through the compositor-only
`transform`/`opacity` sinks with zero reactive flushes; and the rated
publish samples at 15Hz against the generated descriptor's
`publishBudget` (sustainedHz=20) — codegen now emits those budget facts
in `webCursors.publish.contract-meta.ts`, and the Exact analyzer errors
at compile time if a channel declares a rate above them.

Acceptance: 6/6 green (two headless windows converge through generated
bindings + the rated publish; the sink transform lands
(`translate(242px, 292px)` for a move to 250,300 — element-local minus
the half-dot offset); channel + publish facts and the `established`
publish receipt are live-readable through the same
`getContractDataflowSnapshot` the agent surface serves; forced-map
LOCAL-ONLY + recovery unchanged).

### Stage-1 decision data (Exact LLP 0281 §5 OQ1 — where the channel model chafed)

Pre-registered honestly, friction first:

1. **One-logical-line instantiation.** The channel options object (publish
   + rate + payload mapping) must sit on one line — Contract has no
   bracket continuation — and ours runs ~200 chars. Ugly but shallow; a
   formatter/continuation fix, not a semantics gap. Stage-1's `publish
   <channel> -> <desc> rate=N` declaration would also dissolve it.
2. **Identity plumbing was friction-free** — name/color enter as ordinary
   props and the payload mapping reads them per tick (§3.4
   normal→transient reads). No lane crossing needed, no `transient`
   declarations missed.
3. **Nothing needed composition.** Cursor presence needed exactly one
   channel, zero derived channel math, zero multi-value gestures. The
   §3.3 sink expressions (translate + literal offset, ternary opacity)
   stayed inside the channel+literal confinement without strain.
4. **Two real integration potholes, both host-level, neither
   language-level:** (a) cross-repo `@exact/*` descriptor resolution had
   to learn the compiler-checkout fallback (fixed in Exact, `253a39eb`);
   (b) browsers pause rAF in background tabs, which stalled coalesced
   delivery for a hidden window still receiving synthetic events — the
   channel clock now degrades to the platform's throttled timer cadence
   when hidden, and the acceptance activates a window before moving its
   pointer (which is what a real pointer implies anyway).

**Verdict input:** for the presence/cursor class of surface, stage 0
sufficed — no `transient` declarations, no symbol-class analyzer, no
composed channel expressions were missed. The chafing that exists is
spelling ergonomics (the one-line options object), not model shape. On
this evidence the `transient` language lane stays unjustified; the next
probe that could justify it is the freehand-drawing class (draft-stroke
buffers — LLP 0275 B1's DrawingSurface plus bounded buffer types), not
cursors.

### Net

The demo's claim upgraded from "presence through generated bindings for
the read side" to **presence with zero imperative surface code in either
direction**. 840 deleted lines, one `.contract` file, one bootstrap
module. The framework-free reference implementation this diary
originally documented now exists only in git history — which is exactly
the graduation LLP 0025 and the deletion budget wanted.

## 2026-07-04 - The last sibling-checkout surface breaks (ENG-22797)

### What broke

The `contract-browser` acceptance suite went 0/7 with the opaque "surface
never booted", while the React control arm stayed 7/7 — so the backend and
harness were fine. `vite build` of the contract surface names the real cause:
`@exact/contract/runtime` / `@exact/renderer/web-host` (imported by `main.ts`)
no longer resolve. This surface is the **last** one still consuming Exact from
the sibling `../exact` **source** checkout. The `exactContractWeb` preset used
to inject `@exact/*` source aliases (`contractWebSourceAliases`), but exact
`162e2b7e` (LLP 0264 §4.2) deleted that whole machinery when All Aboard moved
to published registry packages (ENG-22480). cursors-web never migrated, so a
`main.ts` living outside the Exact tree has nothing to resolve `@exact/*`
against once the aliases are gone.

### Why the durable fix is blocked

The real fix is the all-aboard-style migration to published
`@ccheever/exact-*` (ENG-22564). But only `0.1.0` is on the registry, and
`0.1.0`'s Contract compiler predates the rated `publish` view line this
surface's `app.contract` is authored against (LLP 0281 stage 0, exact
`70e5df8f` — packed after `0.1.0`). Migration needs `0.1.1` published, which
is OTP-gated external work (ENG-22564), not landable from here.

### Interim bridge + honest failure (what I shipped)

Re-homed a trimmed copy of the retired `contractWebSourceAliases` into the
surface's own `vite.config.ts` (LOCAL to this one pinned surface, so nothing in
Exact carries it again), plus a preflight that hard-fails with a clear
diagnostic — naming the missing files and pointing at ENG-22564/ENG-22797 —
when the sibling checkout can't satisfy the imports. That honors LLP 0015's
"capability, not directory" rule: a stale peer checkout must fail loudly, never
hang. Because a `vite.config` throw exits vite non-zero, the suite surfaces it
through its existing "Vite exited" path instead of the 20s boot timeout.

### Observations (Exact/Contract vs the migrated path)

- The friction is entirely in Exact **consumption topology**, not Contract
  authoring: against current `../exact` source the `.contract` compiles clean
  (`publish` view line and all) — a full 136-module `vite build` succeeds. This
  is the same class of pothole as 2026-06-28 #4 (cross-repo `@exact/*`
  resolution), and it keeps recurring precisely because this surface rides the
  sibling-source seam that all-aboard already left behind.
- Retiring the source-alias machinery in Exact was right for migrated surfaces
  but stranded the last un-migrated one; the sibling-source world is inherently
  fragile to the sibling's HEAD, which is the whole thesis of ENG-22797. The
  published-package world (`@ccheever/exact-*` in the surface's own
  `node_modules` + a committed `bun.lock`, as all-aboard now has) deletes this
  failure class outright. This surface is the canary for finishing ENG-22564.
- Snapback itself was blameless here (React arm green); the coupling is purely
  the surface↔Exact-source seam.

### Verification and its limit

Verified the fix at the resolution layer both ways: `vite build` clean (136
modules), and `vite dev` serves `main.ts` (200) with `@exact/renderer/web-host`
resolving to the sibling source and the ENG-22757 `/__snapback/source`
provenance probe still answering 200 under `--strictPort`. The loud-failure
path was verified by pointing `SNAPBACK_EXACT_ROOT` at an incompatible dir —
vite exits 1 with the diagnostic. I could **not** run the full 7/7: the suite
cold-builds the Rust/ibex backend (`cargo run … --memory`), too heavy to bring
up reliably here (a sibling worktree was mid-build). Runtime 7/7 remains
dependent on the sibling checkout's state until ENG-22564 lands.

## 2026-07-09 — ENG-22564: the canary bridge is deleted

The predicted end state finally landed: cursors-web now consumes Exact `0.1.2`
from its own package aliases and committed `bun.lock`. The re-homed source alias
matrix, checkout capability preflight, `exact.pin.json`, and `cd ../../exact`
scripts are all gone. The production-build gate now treats any surviving pin or
missing lock as a hard error, so this exact dev-green/ship-broken failure class
cannot silently return.

The current Contract and React acceptance suites each pass 9/9 against that
registry install, including the server-restart proof. That restart probe now
re-provisions through the same idempotent `/app/ensure` contract as the real
surfaces; its old direct `/_snapback/api/schema/load` call became admin-gated
and was testing harness privilege rather than reconnection behavior. The React
bootstrap had the same stale privileged fallback after an unknown-collection
response, so it now uses `ensureApp({ schema })` directly, matching the
Contract arm and keeping browser boot on the public D4 path.
