# Diary 0011: cursors-web — React control arm (red-team #3)

**Demo:** Web cursor presence (`demos/cursors-web/`)
**Surfaces:** contract (required), react (control_arm — this exercise)
**Author:** Claude (Fable 5), agent-authored, RED-TEAM mandate — tasked with making the strongest honest case for React; third control-arm exercise, judged independently of the others
**Date:** 2026-07-02
**Related:** ENG-22531, ENG-22524, Diary 0007, LLP 0013, LLP 0034, Exact LLP 0281/0284
**Exact pin:** `253a39eb` (unchanged; the pinned revision is the toolchain under test, run from a dedicated worktree)

## Framing caveat

Three things the reader should weigh before the numbers:

1. **I saw the expectation.** The tasking issue's own description states the
   outcome its author expects. I could not avoid reading it (I was directed
   to post progress on the issue). I flagged it in my first comment, did not
   weight it, and guarded against both confirmation and contrarian
   overcorrection: every claim below traces to an artifact produced in this
   run (probe JSON, suite output, timestamps, commits). I did not read
   diaries 0009/0010 or the Exact strategy LLPs.
2. **One author, both arms.** The same agent wrote and debugged both sides,
   in one session, with the Contract arm pre-existing (I wrote only its two
   edits). Learning effects favor whichever arm goes second in each cell;
   this round ran React-first on both edits (runs 1/2 alternated the order).
3. **n=1 app class, n=1 session.** Cursor presence is small, ephemeral-only,
   web-only. Numbers below are honest for this class; extrapolate with care.

Correction against my own progress comment on the issue: I estimated the
React arm at "≈2h" mid-flight. The timestamps say phases 1+2 took **~23
minutes** wall from worktree creation to both suites green (recon included;
environment builds ran in parallel). The 2h figure was wrong; this diary is
the record.

## What I built

`demos/cursors-web/surfaces/react/` — stock React 19 + Vite 7, self-contained
`package.json` + `package-lock.json` (120 packages incl. transitive, 72MB
node_modules, `npm install` 6.5s), TypeScript strict. Same product, same
testIds, same Snapback ephemeral backend, same generated artifacts
(`api.mjs` refs; `schema.manifest.json` publish-budget facts; payload types
via `import type` from the generated `api.d.ts`). The hand-wiring the
mandate asked for lives in one hook:

| File | Lines | Role |
|---|---|---|
| `src/useCursorRoom.ts` | 484 | overlay subscribe, connection axis, TTL-prune re-emit, resync + reconnect re-entry, 15Hz leading+trailing throttle, direct-ref self dot, LOCAL-ONLY force plane, publish facts |
| `src/App.tsx` | 277 | view (inline styles), E5 picker, E6 fade clock, debug surface |
| `src/main.tsx` | 65 | D4-shaped boot (health → ensure → provision-if-unknown), identity, render |
| `src/palette.ts` | 9 | E5 palette (own module — Fast Refresh rule, see below) |
| `src/snapback-kit.d.ts` | 71 | hand-written ambient types for the untyped kit client + generated api.mjs |
| config/scaffold (html, vite, tsconfig, package.json) | 97 | stock Vite host |

Plus `tests/acceptance/react-browser.mjs` (278 lines) mirroring the Contract
acceptance check-for-check on dedicated ports (4426/5187), hardened
`runAcceptance` + `expectedChecks: 6`.

**Both suites green before judging:** react 6/6 (first suite run), contract
6/6 (re-verified against the pin). Re-run green after every edit below.

### The one real bug of the build — and where it lived

The first live two-window run lost **one direction of convergence** (bob
reached alice; alice never reached bob). Root cause: I gave the page ONE
connection id, and React StrictMode's mount→unmount→mount churned the
socket under it; the server drops a connection's subscriptions when its
socket closes (Diary 0007's close→disconnect wiring), and the teardown of
socket #1 raced the second subscription to death. Silent — nothing threw.
Fix (~5 min once diagnosed): connection identity **per effect lifecycle**,
plus fresh-subscribe re-entry on socket regain, mirroring the kit's own
durable-lane policy. Two more footguns of the same species never went live
but were caught only by review: a stale-closure republish (E5's color would
have published one change late) and an unstable effect-dep object (debug
surface re-wiring every render). None of these classes exist on the
Contract side — there is no app-authored lifecycle to get wrong.

That cuts both ways, and honestly: because I OWNED the transport policy, I
could make it better than the shared adapter's — and did, which decided the
reconnect probe below.

## Matched edits (phase 3, React arm first this round)

| Cell | Wall clock | Attempts to green | Errors on the way | Suite after | Diff size |
|---|---|---|---|---|---|
| E5 color picker — React | ~3.5 min | 2 | 1 stale identifier (tsc caught, pre-run); 2 design footguns caught in review | 6/6 | ~+65/−8 across 3 files |
| E5 — Contract | ~5 min (incl. ~2 min reading the pinned channel source) | 1 | 0 — first-try compile; one noisy warning (below) | 6/6 | ~+13/−2, one file |
| E6 idle fade — React | ~1.8 min | 1 | 0 | 6/6 | ~+30/−3 |
| E6 — Contract | ~1.3 min | 1 | 0 — first-try, incl. `now()` in the payload lane | 6/6 | ~+15/−1, one file |

Feature probes (headless CDP, scripts in the session scratchpad): E5 —
pick-swatch on B converges on A (React: with **zero** movement after the
pick; Contract: on the next pointer sample); E6 — fresh=1.0 opacity,
survives past the old 5s TTL, fades to 0.25 at >5s idle, restores to 1.0 on
movement; both arms identical on E6.

**The E5 delta is a real stage-0 wall.** `ChannelPublisher` fires only on
channel writes; there is no programmatic emission, so "publish my new color
now" is inexpressible in the Contract arm — worse, before E6 widened the
TTL, picking a color and then not moving let your presence expire outright
(the probe caught the entry vanishing). In practice the pointer leaves the
picker and the color lands within a sample or two, so the product impact is
small — but the ceiling is real and React simply doesn't have it. On the
other side: the Contract edits were *fast* — prop-initialized state, an
array-literal derive, a parameterized action, indexed `each`, `??`, and
`now()` in the payload mapping all compiled first try over live HMR, and
E6-Contract was the fastest cell of the four.

## Measurements (phase 4)

### Hand-authored LOC (final tree, lockfile and generated files excluded)

| | Contract arm | React arm |
|---|---|---|
| App/UI source | 84 (`app.contract`) | 835 (`useCursorRoom` 484 + `App` 277 + `palette` 9 + kit types 71 — the glue IS app source here) |
| Bootstrap | 148 (`main.ts`) | 65 (`main.tsx`) |
| Config/scaffold | 98 (vite config 57 + html 22 + package 8 + pin 5 + ts stub 25*) | 97 (vite 36 + html 22 + package 22 + tsconfig 17) |
| **Total** | **330** | **993** |
| Acceptance | 290 | 278 |

*The 25-line typescript stub exists only because of the build finding below.
3.0x overall; the glue hook alone is 1.5x the entire Contract arm.

### Production builds

| | Contract (preset, bun) | React (stock vite, node) |
|---|---|---|
| First attempt | **DNF** — native-leak gate: `node:*` in client chunk | green, 592ms |
| After workaround | 266ms | — |
| dist JS | 386KB (gzip ~111KB) + 1.8MB map | 223KB (gzip 70KB) |
| Built artifact verified | yes — two-window convergence E2E | yes — same probe |

**The DNF is the phase's headline.** On the pinned revision, `use
pointerChannel from "@exact/contract/channels"` reaches
`compiler/purity-inference.ts` through module-scope **value** imports
(`channels.ts → exports.js → import-boundaries.js`), dragging the entire
TypeScript compiler into the client graph; its `node:sea`/`node:sqlite`
string literals trip the preset's own native-leak gate. all-aboard (no
channels) builds green on the same pin, isolating it to the stage-0 import
surface. Nothing on the browser runtime path ever calls the inference, so a
build-only alias stub (surface-owned, loud on touch) unbricks it — commit
`cdc1338`. Until this run, the rebuilt Contract surface had no build script
and had evidently never been production-built: **dev green, ship broken.**
The gate did exactly its job; the graph hygiene did not.

### Dev loop / HMR (live two-window sessions, presence flowing)

| | Contract | React |
|---|---|---|
| Dev server up | 584ms (vite 8 under bun, preset) | 403ms (vite 7, node) |
| Benign text edit → visible | **245ms** | 1067ms |
| Reload type | in-place reset-remount | Fast Refresh (after fix) |
| Presence identity survives edit | yes | yes (after fix) |
| Out-of-the-box trap | — | `CURSOR_PALETTE` export in App.tsx disabled Fast Refresh → every App edit full-reloaded both windows with identity churn; the console message names the rule; fix = move the const out (commit `a38debd`) |

### Symmetric error DX (identical typo per arm: `.valu.color` in the cursor render expression)

| | Contract | React |
|---|---|---|
| Overlay | **yes** — vite overlay: `[contract] cannot read "color" of undefined` + `app.contract:67:59 (view <column> in CursorRoom)` | none (runtime errors don't hit vite's overlay) |
| Console | source-mapped file:line:col + view context + code frame of the `.contract` source — but repeated **every render tick** (~1/s spam), and the code-frame caret line truncates at the error column (`> 67 | c`) | one clean `TypeError: cannot read properties of undefined (reading 'color')` with dev-URL file:line, full component stack, and an actionable "add an error boundary" hint |
| Pixels | **keeps last-good UI** — count, cursors, presence all still render; live session continues | **blank page** — root unmounts (no error boundary in the arm) |
| After revert | hot-recovers in place, same connection id, presence intact | recovers via reload, **new presence identity** (this probe predates the Fast Refresh fix) |

Contract's error *locus* is better (real source line + view context +
last-good pixels); React's error *report* is better (one clean message vs a
spam loop). A 10-line error boundary would close React's blank-page gap;
per-locus dedup would close Contract's spam gap. Both are cheap fixes —
they just default differently today.

### Operational stability / WebSocket reconnect (both arms simultaneously, one probe)

Kill the shared API mid-session → restart it → re-provision schema (a fresh
`--memory` server needs loadSchema before ensure — my first probe run got
this wrong and proved neither arm can self-heal a schema-less server; both
sat honestly degraded) → wait out reconnect budgets → fresh move.

| | Contract | React |
|---|---|---|
| During outage | banner `connection: stale`, frozen entries (correct LLP 0034 semantics) | same |
| After restart + fresh move | banner `live`, but **frozen pre-restart data** — B's new position never arrives (left stuck at 260px) | banner `live`, **full recovery** — fresh move arrives (left 400px) |

The React arm recovers because MY glue re-enters through a fresh subscribe
on socket regain (a policy I added after the StrictMode incident). The
Contract arm's shared adapter (`packages/snapback-contract`) re-subscribes
ephemeral overlays only on in-band `needs_resync` messages — after a server
restart no message ever arrives, so the room is silently dead under a live
banner **and the app author cannot fix it from `app.contract`**. This is a
snapback adapter bug, not an Exact bug, and it is the sharpest genuine
React win in the run: owning the transport policy meant I could make it
correct.

Other ops notes: the pin machinery behaved perfectly (sibling checkout had
moved 28 commits past the pin; a dedicated worktree at `253a39eb` + `bun
install` took ~4 min once, and the preset's `pinned Exact checkout
verified` banner confirmed every boot). Port hygiene held (dev on
4425/5184/5186; suites spawn their own 4426/5187; nothing squatted, and I
killed only servers this session started). One snapback-repo friction: a
fresh worktree's `vendor/ibex` submodule clone from GitHub failed, and
`bootstrap-ibex-runtime` had already half-populated the directory, so the
retry couldn't clone either — cloned from the main checkout by hand and
restored the artifacts (~15 min, charged to neither arm).

## Nice / annoying, per arm

**React — nice:** the toolchain is gloriously boring (npm install 6.5s →
dev server 403ms → build 592ms, first try, no checkout, no pin, no
runner quirks); tsc + the generated `api.d.ts` types caught my one
compile-slip before runtime; refs matched the compositor-path self dot
with the SAME observable behavior, asserted synchronously; no
expressiveness ceiling anywhere — E5's zero-movement republish and the
reconnect policy were both just... written; smaller bundle (223KB vs
386KB); the error report is one clean message.

**React — annoying:** 3x the hand-authored lines for the same product; the
entire realtime lifecycle is my promise to keep — and the run's only live
bug, plus two review-caught footguns, all lived exactly there; the
StrictMode/connection race was silent (a one-window test would have
shipped it); rate/TTL/budget discipline is runtime-asserted at best where
Contract gets it compile-checked against generated facts; blank page on
render error by default; the Fast Refresh mixed-exports trap cost every
App edit a full reload until a probe caught it.

**Contract — nice:** 84 lines of `.contract` IS the whole app; both edits
compiled first try with grammar to spare (prop-init state, param actions,
array literals, indexed `each`, `now()` in the payload lane); 245ms HMR
with presence identity intact; error locus with real source line + view
context + last-good pixels; declared publish rate compile-checked against
the generated budget; the channel/publish facts ride a standard dataflow
snapshot the acceptance reads instead of hand-built counters.

**Contract — annoying:** the production build was BROKEN on the pin until
this run stubbed the compiler out of the client graph — dev-green,
ship-broken is the worst possible default; the toolchain needs the Exact
checkout, bun, and pin ceremony (cold-clone contributors can't run it
today); stage-0 channels can't emit programmatically (E5's delta, and no
keepalive heartbeats expressible either); render-expression errors spam
per tick; the zero-size-button warning fires even with explicit
width/height; the ~200-char one-line channel options object is still ugly
(Diary 0007 pre-registered it; still true).

## The verdict

**(a) Contract ships.** The React arm is the best control arm I could
build — typed end-to-end, StrictMode-safe, reconnect-correct, faster to
production-build, with real headroom the Contract arm lacks — and it still
loses the decision for this surface, on this evidence:

- The only live correctness bug of the exercise was in the hand-wired
  realtime glue, its failure mode was silent one-directional presence
  loss, and the class regenerates with every future realtime feature (E5's
  stale-closure near-miss was attempt two at the same species). The
  Contract arm makes that class structurally inexpressible: 84 lines in
  which there is no lifecycle to race.
- The maintained-surface asymmetry is 3x overall, but the honest cut is
  sharper: ~835 lines of app-owned realtime machinery versus zero. On a
  corpus where every other surface is Contract, that is the difference
  between "the demo exercises the platform" and "the demo maintains a
  private platform."
- Day-to-day iteration measured better where it matters for this demo's
  life as a fixture: 245ms vs 1067ms HMR, identity-stable hot edits from
  the start, source-line error locus with last-good pixels, and the two
  edits landing first-try in ~1.3–5 min each.
- Both Contract losses that would have flipped this verdict were run to
  ground and neither is architectural: the build DNF is an import-hygiene
  bug with a verified surface-owned workaround (and a one-line real fix
  waiting in Exact), and the dead-room-after-restart is a snapback adapter
  gap that one `needsResubscribe` mirror of the kit's own durable-lane
  policy closes for every Contract surface at once — whereas the React
  arm's equivalent correctness depends on each app author re-deriving it.

**(b) The strongest case for React** (I mean this; it nearly carried):
React was the only arm that could **ship a production build out of the box**
and the only arm that **actually recovered a live room after a server
restart** — on the two most operationally consequential probes of the run,
stock React won both. Its toolchain is self-contained and instant where
Contract demands a sibling checkout, a pin, and bun; a cold contributor is
productive in minutes. And it has no ceiling: E5's publish-on-pick was
inexpressible in stage-0 Contract but trivial in React, which generalizes —
heartbeats, join/leave events, any programmatic emission. If this surface
were a standalone product with no platform investment behind it, those
three facts — ships today, self-heals today, no walls — would make React
the defensible choice, and the 3x LOC would be the fair price of owning
your transport.

**(c) Flip conditions** — specific and checkable; any one flips the verdict
for this surface class:

1. **Programmatic emission stays missing while a requirement needs it.** If
   a presence surface requires event-driven publishes (heartbeat
   keepalives, join/leave announcements, publish-on-pick as a hard product
   requirement) and the then-current pin still exposes no channel emission
   API (check: does `pointerChannel`'s set — or a successor — accept a
   non-pointer write path?), build that surface in React.
2. **The pin ships another dev-green/build-broken regression.** If a future
   pin bump fails `vite build` on this surface again without a
   surface-owned workaround (check: build green with the typescript stub
   DELETED), the toolchain has forfeited the default until it holds a
   "required surfaces production-build on every pin bump" gate.
3. **The adapter gap outlives a quarter.** If
   `packages/snapback-contract` still cannot recover an ephemeral room
   after server restart by 2026-10-01 (check: the reconnect probe's
   `left: 400px` on the contract column), the "framework owns the
   lifecycle" argument inverts — at that point the hand-wired arm is
   simply the more correct one, and correctness was the whole case.
4. **Cold-clone onboarding becomes a real constraint.** If contributors
   without the Exact checkout must run this demo (check: `git clone` →
   running dev in under 5 minutes without `SNAPBACK_EXACT_ROOT`), React
   wins that constraint until published `@exact/*` packages make the
   Contract surface self-contained.

## Punch list

- **P0 (Exact):** stage-0 channels import drags the TypeScript compiler
  into the client graph (`channels.ts → exports.js → import-boundaries.js
  → purity-inference.ts` value-import chain); production build DNF behind
  the native-leak gate. Fix: type-only/lazy imports on that edge; then
  delete this surface's `typescript-browser-stub.mjs`.
- **P1 (snapback, packages/snapback-contract):** ephemeral overlays never
  re-subscribe after socket regain (only on in-band `needs_resync`), so a
  server restart leaves every Contract room silently dead under a `live`
  banner. Mirror the kit's durable-lane `needsResubscribe`-on-open policy.
- **P1 (Exact):** render-expression runtime errors re-report every
  evaluation (~1/s per broken node with a ticking clock). Dedupe by locus.
- **P2 (Exact):** error code frame truncates the caret line at the error
  column (`> 67 | c` for col 59); print the full source line.
- **P2 (Exact):** zero-size-button warning fires on `button label=` even
  with explicit `width=`/`height=` attrs (the diagnostic's own escape
  hatch).
- **P2 (snapback):** `bootstrap-ibex-runtime` half-populates `vendor/ibex`
  before checking it is a git checkout, wedging fresh worktrees whose
  submodule clone fails; make it clone-first (or document the
  local-checkout fallback).
- **P3 (react arm):** add an error boundary so render errors keep
  last-good pixels (parity with the Contract behavior); consider the same
  for any future React control arms so the error-DX comparison stays
  symmetric.
- **P3 (both arms):** the E5/E6 feature probes live in the session
  scratchpad; if the edits graduate into product claims, promote them into
  the acceptance suites (both, to keep the mirror).
