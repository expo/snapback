# Diary 0019: Graffiti adopts RQS Channel A (inlined web boot)

**Demo:** `demos/graffiti` — the collaborative pixel wall
**Work:** LLP 0090 rollout step 3 (ENG-25454 under ENG-25446): the 0C
enforcement pipeline (routes manifest, `publicInline`, derived
`rqsEligible`), the `snapback-vite` Channel A serving seam, and graffiti as
the first app whose first paint comes out of the served HTML.
**Author:** Claude (agent), 2026-07-24

## 2026-07-24 — building the demoable milestone

### What was built, from the app author's seat

The app-facing surface area of Channel A turned out pleasingly small. To make
the wall paint from the document, graffiti needed exactly three things:

1. Three words on the query (`snapback/functions.mjs`):
   `auth: 'public', authorityIndependent: true, publicInline: true`. The
   layered declaration model reads well from the author's chair — public says
   who may call, authorityIndependent says everyone sees the same rows,
   publicInline says those rows may ride tokenless HTML. Each is separately
   refused if unsound, and codegen rejected my first attempt (publicInline
   without the other two) with a one-line diagnostic that told me what to add.
2. A 12-line `snapback/routes.mjs` with `defineRoutes` + `routeParam`. The
   `params-v1` mapping is deliberately dumb (literals and `:param` names) and
   that was enough: the wall needs `{ boardId: 'wall' }` on `/` and
   `{ boardId: routeParam('boardId') }` on `/board/:boardId`. I never wanted
   an expression language.
3. One plugin line in `vite.config.ts` (`snapbackChannelA({ origin,
   routesManifestPath, functionsManifestPath })`) plus one line in the ensure
   call (`routes: routesManifest`) and a `rqsPreload` lookup handed to the
   Contract surface. The client-side consumption
   (`readRqsPreloadRegistry()` → per-query `consume`) is ~4 lines of app
   code.

Measured on the acceptance run (dev-mode Vite, in-memory SQLite, 59 seeded
cells; `demos/graffiti/tests/acceptance/channel-a-browser.mjs` prints these
as the §Scalability gate record):

- page-query (bundle) evaluation: **~5.2–5.5 ms** for the 59-row wall
- embedded payload: **10,923 bytes**; transformed document: **11,711 bytes**
- first rows visible: **~113 ms** after navigation start — before the live
  socket existed at all (first live WS frame ~198 ms)
- live socket attached: **~142 ms**; proved current (`CurrentAsOf`):
  **~146–158 ms**
- the resumed subscribe carried the token and came back with **no snapshot**
  and **zero `live_replace` frames** — the inlined rows were never refetched

That last line is the Convex-comparison headline this program aimed at:
Convex's `preloadQuery` re-executes the full query after hydration; here the
wire answer to "I already have the rows you inlined" is a ~200-byte
`current_as_of` envelope.

### What was ergonomic

- **The closed union did the client work for me.** `resume` present iff
  `rqsEligible` meant the preload registry needs no eligibility logic at all:
  an entry with a token is preloadable, an entry without one isn't. The
  server-minted token doubling as the eligibility proof (LLP 0092 §0C.5's
  promotion check) collapsed what I expected to be a manifest-consultation
  dance into a `Map` keyed by `rqsEntryKey`.
- **Step 5's `preloadedResume` seam was exactly the right shape.** Channel A
  plugged into the kit's existing verify → arbitrate → render-retained →
  resume flow without touching the subscription state machine. The whole
  client delta for step 3 is a registry module and an option pass-through.
- **Degrade-to-shell is a genuinely nice dev posture.** The first pageload
  against an unprovisioned backend just serves the ordinary shell and the app
  boots the old way; the second pageload is hydrated. No error state, no
  ordering ceremony between `vite dev` and the backend. The acceptance suite
  leans on this (its first check IS the degraded load).
- **Codegen as the manifest authority felt right.** `routes.manifest.json`
  falling out of `node packages/snapback-codegen/index.mjs
  demos/graffiti/snapback` beside the other artifacts — same hashing, same
  deterministic bytes, one `git diff` to review — made the new artifact feel
  native rather than bolted on.

### What was hard or surprising

- **"First paint before any WebSocket frame" is not free with a
  mount-after-subscribe surface.** The Contract multi-live surface awaits
  health → ensure → subscribe before mounting, so even with the payload in
  hand the wall would first paint *after* the socket opened. Graffiti now
  pre-paints the wall grid synchronously from the payload (plain DOM,
  removed at mount). It is ~20 lines and honest — but the real seam is
  LLP 0063's hydration authority; a surface that mounts from preloaded
  stores would make the pre-paint unnecessary. Recorded as the step-3 lesson
  for the D5/0063 conversation.
- **The escaping trap is real and I nearly walked into it myself.** While
  authoring the serializer I twice produced source with literal U+2028s where
  escape sequences were intended (invisible in every editor view). The
  byte-pinned fixtures caught it instantly, which is exactly why they exist;
  the runtime whole-output byte check (`SNAPBACK_INLINE_SERIALIZER_UNSAFE`)
  guards the same class in production paths. Verdict: the fixtures-as-bytes
  discipline (generated programmatically, never typed) earned its keep.
- **Vite's dependency-optimization reload fights boot instrumentation.** The
  dev server can replace the document mid-boot on a cold cache, which
  orphans `MutationObserver`s and kills in-flight CDP evaluations. The
  acceptance probe needed a polling fallback and eval retries. App code is
  unaffected (the reload just re-runs the boot, and the fresh document gets
  a fresh payload), but measurement code should know.
- **The probe must distinguish the app's socket from Vite's HMR socket.** A
  naive "no WebSocket frame before paint" assertion fails on the HMR
  socket's ping. Filter on the `/live/{grant}/stream` URL.
- **AST-derived param typing worked but is the subtle corner of 0C.** The
  server has no manifest-carried arg schemas, so `:rank`-style number params
  are typed by walking the query plan (arg compared against an
  integer-typed schema field ⇒ strict integer decode). It covers graffiti
  and every declarative HostPlan query, but references are only typable at
  top-level arg positions — nested references refuse at admission. Fine for
  v1; a manifest-carried arg schema (coming with the step-4 deploy-time
  work) would make it less clever.

### Against the familiar alternatives

- **React + Convex:** `preloadQuery`/`usePreloadedQuery` needs a Next.js
  server component and re-executes the query client-side after hydration.
  Here the equivalent is three declaration words + a routes file, works on a
  plain Vite SPA, and resumes with a proof instead of a refetch. Convex's
  authoring ergonomics for the preload call itself are comparable; the
  differentiator is entirely in what happens after hydration and in the
  single-commit bundle cut.
- **Supabase:** no analogous primitive — you would hand-roll an endpoint
  that runs the query server-side, inline it yourself (and get the
  `</script>` escaping right yourself), and there is no resume token, so
  the realtime channel re-syncs from scratch regardless.
- **Exact/Contract observations:** the preset composition story was clean —
  `snapbackChannelA` sits beside `exactContractWeb` without either knowing
  about the other (OQ-C's first option). The one Contract-shaped friction is
  the mount-after-subscribe boot above; Contract owns the mount, so the
  pre-mount paint had to live in `main.ts` rather than in the surface.

### Deferred / follow-ups

- Cloudflare arm (rollout step 4) — the seam contract is written to be
  reimplemented over `env.ASSETS.fetch`; the serializer fixtures are shared.
- Manifest-carried per-function `queryArtifact` hash (kept content-derived;
  LLP 0091/0092 dated amendments record the standing rule).
- Sessions-mode complete-pair provisioning of the routes manifest (dev-loop
  legacy ensure only today).
- Read-mode bundles on the concurrent read lane inside
  `with_pinned_read_snapshot` (serialized-lane cut is correctness-identical
  but pays the writer lane).
- Pre-existing, unrelated: two graffiti headless ephemeral-presence checks
  (`disconnect removes the connection-owned cursor`, `TTL expiry prunes an
  idle cursor`) fail at the step-2 base commit on this host too — not a
  step-3 regression; needs its own investigation.

## 2026-07-24 — the widget-shaped read-mode surface (LLP 0090 rollout step 7, ENG-25458)

Graffiti grew its second Channel C consumer: `surfaces/widget/render.mjs`, a
socket-less widget in D4's WidgetKit/complication shape — one anonymous
read-mode `POST /app/bundle` against the parameterized `/board/:boardId`
route, a last-writer-wins text render of the wall, exit. Deliberately **no
client kit at all**: plain `fetch` is the whole transport, which is the
point — a constrained extension process gets current rows without any of the
subscription machinery.

### What the widget case proved about the contract

- The v1 socket-less rule (public/`publicInline` bundles only) needed zero
  new declarations: the step-3 triple on `listCells` was exactly what
  admitted the anonymous read. The layering worked as designed — the widget
  surface added *no* authority surface.
- The anonymous-register refusal behaves as LLP 0092 §0D.2 demands: the
  widget asks for register, gets the coded
  `SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL`, and retries with an
  explicit read request — the acceptance pins that this is two visible
  requests and never a silent mode substitution.
- Deep-link + widget turned out to be the same motion: the widget's request
  IS a params-v1 cold start into a parameterized route. A different board id
  renders that board's wall from one request with nothing else changed.
- The public entry is rqsEligible, so the widget receives a resume token it
  has no use for — harmless (it could seed a future socketed session), but a
  per-manifest-entry "no tokens needed" hint could shave bytes for pure
  read-and-exit consumers someday. Not filed; the token is ~200 bytes.

Acceptance (`tests/acceptance/widget-read-mode.mjs`, in the local proof)
poisons the global `WebSocket` constructor for the whole run — "no socket
opened" is enforced by construction, not observation — and additionally
proves the CLI lifecycle terminates on its own (a held socket would hang the
event loop and trip the timeout).

Cosmetic observation, not a defect: read-mode public bundles serve
`Cache-Control: no-store, private` where the taxonomy row says `no-store`
(strictly stronger, same v1 posture).
