# LLP 0052: Contract update economy and reactive host state

**Type:** RFC
**Status:** Review
**Systems:** Contract/Exact, Developer experience, Demo apps
**Author:** Claude (Fable 5) / Charlie Cheever
**Date:** 2026-07-11
**Revised:** 2026-07-11 (ENG-24189 Phase 0 web baseline recorded — four-arm
20.25 s matrix over the real All Aboard surface; D3/D2/D5 numeric gates fixed
from the raw counters; physical-iPhone trace remains explicitly open); 2026-07-11 (round-4 final pass, per the fourth Claude and GPT-5
reviews under `llp/reviews/0052-*` — both SATISFIED, no blocking or major
concerns remaining: header/Status counts corrected (ten helpers, four
rounds); the deadline boundary encoded as first-representable-instant-after
for inclusive predicates; publication staging labeled a proposed D1 rule
with its drain point an open question; the value-equal-commit question
answered from the pinned runtime — a value-equal flush commits and walks
today, Phase 0 measures the cost; the purity-conformance check scoped
transitive with the defaulted arm harmonized; the D1 gate reworded to
affected readers; the location seam's value-side internal readers and
`safeAreaInsets` scoped into the audit); 2026-07-11 (round-3 revision, per
the third Claude and GPT-5
reviews under `llp/reviews/0052-*`: the hidden-reads audit rebuilt —
ten helpers in four classes (declare-and-ignore ticks;
tick-free hidden readers `serviceTint`/`delayColor` that would go stale
after clock deletion; genuinely-time-branching hidden readers; two helpers
undeclared in contract-meta), with a purity-conformance check added as the
second D5 static deliverable and a frozen-clock flip backstop added to the
D1 gate; D1 batching restated precisely (at most one effect flush per root
per host event; publications staged across active action batches); D2
gained the deadline boundary convention, the timezone-generation input, and
sampling-vs-function cadence for interpolation; the D3 gate made two-sided
(changed-text and unhide cases so compare-after-assign cannot pass); the D4
one-row-changed gate narrowed to keyed row bindings with outer-field
observers D3-bounded; the `appGlue` example framed as the LLP 0034
read-only projection; the D5 example and attribution fixture corrected;
cascade wording scoped at the two remaining sites; the mirror-walk cell
corrected to every-node-per-commit; the palette code comment narrowed);
2026-07-11 (round-2 revision, per the second Claude and GPT-5
reviews under `llp/reviews/0052-*`: D1 gained value-delivery semantics —
per-capability canonicalization so record-valued bindings cannot re-create
the fresh-but-equal cascade — and an honest batching/ordering/subscription
model matching the actual viewport precedent (one shared physical listener,
per-root fan-out); the external-state inventory's maps row and reader cells
were corrected and a migration-target column plus the hidden-reads problem
added; D2's temporal inventory was corrected against the shipped app
(freshness is minute-cadence; station art flips at UTC midnight; no
service-day calendar exists) and rebased on deadline-driven invalidation —
a wall-aligned minute timer is up to ~59 s late for target-relative
transitions; D5's provenance claim was corrected (node provenance names
bindings, not upstream derives — compiler-authored labels and causal IDs
are Phase 1 scope) and Phase 0 rebased on the existing churn counters;
D4 gained a composition rule and gate; D3 gained the DOM-observable
snapshot domain, the compare-before-assign trap note, and a topology
qualifier; cascade-magnitude wording softened to the verified scope;
citations fixed (Exact LLP 0292; the LLP 0020 idiom cite replaced with the
practiced-convention evidence); Diary 0008 erratum and the `data.ts`
`@ref LLP 0052` comment correction recorded as companion edits);
2026-07-11 (post-review rewrite, per the round-1 Claude and GPT-5 reviews
under `llp/reviews/0052-*`: the per-host mechanism was corrected — native
element props are already value-diffed before encoding, and native's equality
hole is raw-text re-emits, so the original "props-reference dirtiness on every
host" claim was wrong; D1 rebased on the signal-backed host-capability
precedent; D2 grounded in a temporal inventory; D3 rescoped to the two real
holes; D5's seam corrected and phased behind instrumentation; external-state
inventory completed to six seams; alternatives, ownership, and acceptance
gates added)
**Related:** LLP 0029, LLP 0027, LLP 0021, LLP 0034, LLP 0016, LLP 0051,
LLP 0005 (this repo's Contract/Exact integration explainer — its
capability-artifact split bears on D1's negotiation question; the "LLP 0005
review loop" references below are to the LLP *process* guide), Exact
LLP 0292, Diary 0008

## Summary

All Aboard shipped a scroll-jank bug whose root cause was architectural, not
app-local: **the framework's paved-road idioms compose into worst-case update
cascades**. A 1-second UI clock threaded through most derives (the house
"nowMs cache-buster" convention) and derives returning fresh-but-value-equal
objects each call meant that every tick re-fired the clock-fed derives and,
through their fresh composite results, their downstream readers — 20 of the
app's 28 top-level derives take the clock directly; Phase 0 measures the
true fan-out. What that cascade costs depends on the host:

- **Signal layer (all hosts):** propagation is reference-based (`Object.is`),
  so a recompute that returns a fresh object re-fires every reader even when
  the values are identical; only derives whose results keep a stable
  reference cut the cascade (the version-skip in `signals.ts`), and the
  fresh-composite idiom means most don't.
- **Plain web (DOM mirror):** element change detection is
  props-reference-based (`appliedProps.get(element) ===
  element.originalProps`, the ENG-23260 fast path in `dom-mirror.ts`), so
  fresh-but-equal props re-apply whole elements — and the mirror shares the
  page's main thread, so the recompute and the re-apply both land mid-scroll.
- **Native protocol hosts:** canonical element props and style are **already
  value-diffed** before encoding (`propsEqual`, `collectChangedStyleKeys` in
  `host-ops.ts`; only non-empty buffers dispatch), so fresh-but-equal element
  props produce no ops. The hole is **raw text**: every re-fired text binding
  calls `updateTextContent`, which re-emits the string without comparing it
  to the previous value — so each tick became a batch of same-text ops (each
  a kernel text set, which remeasures — the ENG-23161 posture — except under
  the narrow `canPatchTextNodeWithoutLayout` carve-out for stable-text-hint,
  fixed-layout parents) for the UI thread to apply.

The original draft claimed reference-based dirtiness "on every host"; the
round-1 review falsified that for native element props against the pinned
renderer (blocking finding, `llp/reviews/0052-*.gpt-5.md`). The layered
proposal survives with corrected scopes — and native's existing value-diffed
element path is *evidence for* the approach: the renderer already believes in
value dirtiness at the protocol boundary; it just stops short of the web
mirror and raw text.

The demo mitigated in userland (clock quantization exploiting the signal
layer's `Object.is` skip; palette singletons restoring reference stability),
but every mitigation is a convention the next app must rediscover.

This RFC proposes five framework changes, ordered by leverage:

1. **Reactive host/device state** — a first-class binding for
   device-capability values (color scheme, safe-area insets, geolocation,
   app-defined glue state), built on the existing signal-backed capability
   seam, replacing the module-state-plus-clock hack.
2. **A time primitive** — deadline-driven invalidation (`now(granularity)`
   as periodic-deadline sugar; `invalidateAt(deadline)` for target-relative
   logic), plus host-scheduled time *presentation* so per-second text never
   enters the app dataflow.
3. **Value-completion at the render boundary** — close the two remaining
   equality holes (DOM-mirror element state; raw text on all hosts), so a
   value-equal render emits no host operations by construction.
4. **Derive memoization semantics** — opt-in `memo` with explicit
   comparators, and document that a derive's return identity is part of its
   contract under reference-based propagation.
5. **Update-economy instrumentation** — Phase 0 counters that measure the
   cascade (the baseline this RFC currently lacks), then a dev-mode profiler
   with provenance-joined attribution so the next app is nudged before a
   human feels the jank.

Items 1–2 remove the reason the cascade exists; item 3 makes redundant host
operations impossible; items 4–5 make the model legible while 1–3 land.

## Motivation

### The incident

Diary 0008 (2026-07-11): scrolling the All Aboard board felt janky on a
physical iPhone and on desktop web. The mechanism, per-host, verified against
the pinned `@exact/renderer` / `@exact/contract` 0.1.2 sources:

- The app ticks `nowMs` at 1 Hz (`task ticker mount / every(1000, tick)`) —
  and, by the house convention, so that *module-state glue* (six independent
  seams; inventory below) gets re-derived at all. Twenty of the app's 28
  top-level derives take `nowMs` directly (`app.contract:123–155`).
- Object-returning derives (`themePalette` pre-mitigation, `boardTrains`,
  `feedSourceBadge`, …) return **fresh objects each call** even when every
  value is identical, so reference-based signal propagation re-fires every
  dependent — including every text-binding effect in the view runtime
  (`contract/src/runtime/view.ts` wraps each dynamic text binding in an
  effect that calls `updateTextContent` on every re-run).
- On **plain web**, the DOM mirror's fast path skips a node only when
  `appliedProps.get(element) === element.originalProps` (`dom-mirror.ts`,
  ENG-23260 — "same props reference means nothing to lower or apply"), and a
  reference miss re-applies the whole element. The mirror explicitly serves
  the plain-web path and shares the page's main thread, so recompute and
  re-apply both stall the scroll.
- On **native**, the encoder value-diffs canonical props and style
  (`propsEqual`, `collectChangedStyleKeys`) and dispatches only non-empty
  buffers, so the element side is quiet. But `updateTextContent`
  (`host-ops.ts`) emits the text set without an equality check, so every
  re-fired text binding produces a real protocol op — same string or not —
  and each kernel text set remeasures (ENG-23161; the
  `canPatchTextNodeWithoutLayout` carve-out spares only stable-text-hint,
  fixed-layout parents). The VM running off the UI
  thread does not absorb this: the op batch is applied host-side. (Kernel
  apply-on-UI-thread is asserted from the host architecture; the kernel is
  not in the pinned sources — Phase 0's trace should confirm where the time
  goes.)

### Why this is a framework problem, not an app bug

Each ingredient is the recommended idiom:

- **Pure helpers returning objects, called from view expressions** is the
  practiced Contract authoring idiom: the helper boundary is declared
  `pure({ ..., depends: 'args' })` in `data.contract-meta.ts` (mirroring the
  Exact-side caltrain corpus this app was copied from), and the pattern runs
  through LLP 0027's build and Diary 0008. Nothing tells an author that
  return *identity* is load-bearing — and nothing checks that "depends on
  args" is true (see the hidden-reads note under the inventory).
- **The nowMs cache-buster** exists because glue code has no way to
  invalidate a derive. Contract state is component-owned; everything outside
  it lives in module state behind setters, re-read only because the clock
  forces recomputation. The ticking clock is the only signal that reaches
  everything, so it became the universal invalidation token — making
  *everything* time-dependent.
- **Reference-based dirtiness** is a sound performance choice at the signal
  layer and the web mirror (ENG-23260 fixed the opposite problem:
  re-lowering every node on every commit). It only becomes pathological when
  combined with the two idioms above — and the framework currently combines
  them by default. Native's element path shows the framework already knows
  the answer at one boundary; the web mirror and the text channel never got
  the same treatment.

When the paved road and the pathological case are the same road, the
framework owns the fix.

### The external-state inventory

The draft originally counted "five reinventions"; the round-1 review found
six (round 2 corrected the reader/writer cells), and they are not one kind
of thing — which is why D1 has a classification, not just a binding. Every
seam is invalidated the same way, the `nowMs` tick, which is the finding;
the last column is where each one should live instead:

| Seam | Kind | Written by | Read by | Migrates to |
|---|---|---|---|---|
| `setColorScheme` | Ambient host input | `main.ts` matchMedia listener | `themePalette` via `isDark()`; hidden reads in `serviceTint`, `delayColor`, `locationIndicatorColor`, `feedSourceBadge` | D1 `colorScheme()` binding |
| safe-area insets | Ambient host input | Host writes `globalThis.exact.safeAreaInsets`; `safeAreaInsets()` polls it (`setSafeAreaInsets` exists only as a test override — no production caller) | `insets` derive | D1 `safeAreaInsets()` binding |
| `setDeviceLocation` | Permissioned async sensor | `main.ts` / `native.ts` geolocation glue | `getUserLocation()` inside `getSelectedStation`, `searchStations`, `effectiveEtaMode`, and the walk/bike + distance helpers (all declared pure; derives call *them* — no derive calls it directly); hidden reads of the source in `locationSource`, `locationHint`, `locationIndicatorColor` | D1 `geolocation()` binding (typed pending/denied arms) |
| `setMapsApp` | Persisted app preference | Boot restore from localStorage (`installDirections` → `setMapsApp`); Settings row via `cycleMapsApp` — a web-glue DOM handler, not a Contract action | `mapsAppLabel` (rendered as `mapsAppLabel(nowMs)` — a view-expression cache-buster); the directions-URL glue via `getMapsApp` | Ordinary app state with a persistence story — out of D1's scope |
| `setBackendState` | Provider connection state (LLP 0034's lifecycle axis) | `main.ts` attach/offline paths | `backendStatusNote`; hidden read in `feedFreshness` | Read-only view of LLP 0034's lifecycle axis (D1 exposes, does not own) |
| `setRouteEstimateInvoker` + `routeCache` | Async query results | Route-estimate promise mutates a module `Map` outside the graph; its TTL uses an independent `Date.now()` | `walkBikeLine(…, nowMs)` and the route-line helpers | A query-shaped async resource (the `resource` seam), **not** `appGlue`; its TTL folds into D2's clock authority |

Six seams, one invalidation token, zero declared semantics. LLP 0029 G9 and
G14 register two of them as standing gaps.

**The hidden-reads problem.** The "Read by" column is why a binding alone is
not a migration: ten helpers read scheme, location source, backend state, or
the maps preference as module state *inside* their bodies, and they are
invisible in different ways (audited against `data.ts` and the complete 41-entry
`data.contract-meta.ts`; the round-2 draft of this paragraph got both facts
below wrong, and round 3 caught it):

- **Declare-and-ignore tick helpers** — `themePalette(_tick?)`,
  `mapsAppLabel(_tick?)`, `backendStatusNote(_tick?)`,
  `locationSource(_tick?)`, `locationHint(_tick?)`,
  `locationIndicatorColor(_tick?)` — take a tick they never read; D5's
  declare-and-ignore lint catches this class.
- **Tick-free hidden readers** — `serviceTint(service)`,
  `delayColor(departure)` — have no time parameter at all. Today they pick
  up a scheme flip only *transitively*, because their call sites re-fire
  when clock-fed composite arguments change. Delete the clock and these go
  stale on a scheme change. No parameter lint can see them.
- **Genuinely time-branching hidden readers** — `feedFreshness`,
  `feedSourceBadge` — really use their `nowMs`, and *also* read backend
  state or scheme internally. Not declare-and-ignore cases either.
- **Undeclared helpers** — of the ten, `feedSourceBadge` and
  `backendStatusNote` appear
  nowhere in `data.contract-meta.ts`; they are `use`d without any purity
  declaration at all. For the declared rest, `pure({ depends: 'args' })` is
  already inaccurate — nothing checks it.

Scope note: the ten are the direct hidden readers of the four module-state
kinds above. The location seam's *value* has a further internal-reader
population — `getUserLocation` is called only inside five more
declared-pure helpers (`getSelectedStation`, `searchStations`,
`effectiveEtaMode`, the walk/bike pair, `distanceLabel`), never directly in
a derive — and `safeAreaInsets` is itself a state-reading, fresh-record,
ignored-tick, undeclared helper for its seam. The same purity-conformance
check catches all of these, and the D1 gate's seam-deletion requirement
forces their migration whether or not an enumeration names them.

So the migration requirement is: make each dependency explicit (pass the
binding's value as an argument, or grow a contract-meta declaration for
helper→binding dependencies, e.g. `depends: ['args', 'host.colorScheme']`)
**before** deleting the tick — and enforcement needs two checks, not one:
the declare-and-ignore lint for the first class, and a **purity-conformance
check** (undeclared module/host reads inside a helper declared — or
defaulted — pure are a compile-time or dev-mode diagnostic; a missing
descriptor is itself diagnosable) for the other three classes. The D1
acceptance
gate carries the behavioral backstop: flip scheme, location, and backend
state independently under a frozen clock and assert every affected reader
updates.

### What userland mitigation looked like (and why it is not the answer)

Shipped in All Aboard (Diary 0008, 2026-07-11):

- **Clock quantization**: the ticker writes `now() - now() % 5000`; the
  signal layer's `Object.is` equality-skip (`signals.ts`) turns 4 of 5 ticks
  into no-ops. Frequency treated, size untreated — the every-5s pass still
  recomputes the clock-fed derives and re-fires the effects whose dependency
  versions advanced (for fresh-composite derives, all of their readers),
  re-applying elements on web and re-emitting text on native.
- **Palette singletons**: `themePalette` returns per-scheme module
  constants; a stable reference stops the computed's version from advancing,
  so downstream effects skip entirely.

Both work. Both are conventions an author must know, apply per-derive, and
re-derive from renderer source to understand. LLP 0016's standard applies:
glue that every app must copy is a gap register entry, not a solution.

## Design

### The cost model

The items are not interchangeable; each removes a specific cost. "Empty
patch" is not "free tick" — with D3 alone, the clock-fed derives still
recompute and their downstream effects still re-fire wherever a fresh
composite advanced a version, and on plain web that happens on the main
thread.

| Cost | Runs on | Removed / bounded by |
|---|---|---|
| Derive recompute | VM (= main thread on plain web) | D1/D2 (no per-second invalidation), D4 (propagation cut at value-equal results) |
| Effect re-runs / view re-evaluation | VM | D1/D2, D4 |
| Compare + encode / serialize | VM | D3 keeps it a bounded comparison (no encode when equal) |
| Mirror reconciliation walk (plain web) | main thread | D1/D2/D4 only — the walk visits every node of the synced root per commit and allocates per-parent bookkeeping even when D3 skips every write |
| Op apply + measure/layout | UI thread (native kernel) / main thread (web mirror) | D3 (no redundant ops by construction) |

D1/D2 are therefore not demoted to "optimizations" by D3 — on the DOM mirror
they are what keeps an idle app idle, and even a mutation-free D3 pass is
not free there (zero DOM mutations is not zero mirror work). D3 is the
safety net that makes the *host-facing* cost of a value-equal render zero on
every path.

### D1 — Reactive host state (`host` bindings)

A declared Contract binding for host/device values, symmetrical with `query`
bindings for server data:

```
host scheme = colorScheme()          // 'light' | 'dark', reactive
host insets = safeAreaInsets()       // {top,right,bottom,left}, reactive
host location = geolocation({ mode: "whenAvailable" })
```

**Build on the existing seam, not beside it.** The runtime already has
exactly this mechanism for one value: `viewport`
(`contract/src/runtime/host-capabilities.ts`) is a per-root, owner-disposed,
signal-backed capability with hydration replay (ENG-22563) and a kernel-fed
native-wiring follow-on tracked Exact-side (Exact LLP 0292, the Host Input
Capabilities decision; the pinned source carries one stale "LLP 0293"
comment — 0293 is the slides diary that motivated the capability, 0292 owns
it). D1 generalizes that seam into a declared binding surface. It does **not** hang off the backend capability
manifest (`capability.manifest.json` is `artifactKind: capabilityManifest` —
Snapback target capabilities like cron and live subscriptions, the wrong
artifact); whether host bindings negotiate through the per-root capability
bag or a new host-binding declaration is an open question below, but a
missing capability must be a *declared* gap (the LLP 0029 posture), not
silently-stale module state.

**Not everything in the inventory is a host binding.** The classification
drives the scope:

- *Ambient host inputs* (color scheme, safe-area insets, viewport) — the
  core of D1; the host owns delivery.
- *Permissioned async sensors* (geolocation) — D1 with explicit
  `unavailable` / `denied` / `pending` states in the binding's type, not
  just a default value.
- *Provider connection state* (backend attach) — already has a lifecycle
  axis in LLP 0034; D1 at most exposes it read-only, it does not re-own it.
- *Persisted app preferences* (maps choice) — ordinary app state, out of
  D1's scope; it only looked like device glue because the clock was its
  invalidation token too.
- *App-defined glue* — the typed escape hatch below.

**Value delivery and equality.** Most host values are records (`insets`,
coordinates, tagged permission states), and `signal.set`'s skip is
`Object.is` — a host glue that writes a fresh record per event would
re-create this RFC's disease inside the mechanism meant to cure it. So D1
requires **per-capability canonicalization at the write boundary**: scalar
fields become individual signals behind a stable facade object (this is
literally the shipped `viewport` shape — `width`/`height` signals behind a
getter facade, so the facade's identity never changes), and any
record-valued binding declares an equality relation the glue applies before
writing, so a fresh-but-equal record produces zero propagation. Conformance
shape: *delivering the same value N times produces no signal writes after
the first* — per capability, per host.

**Batching, ordering, and atomicity.** What exists today, stated precisely:
a capability's writes for one host event are wrapped in one `batch()`, which
applies the signal writes immediately and defers the *effect flush* to the
outermost batch exit — and the shared physical callback fans out to per-root
subscribers, so the precedent delivers **at most one effect flush per root
per host event** (the viewport-resize shape), not one global commit.
Ordering (a **D1 rule**, not shipped behavior — no publication queue exists
in the pinned runtime): host-binding publications are serialized with action
commits — a
publication arriving while an action's batch is active is **staged and
applied when that batch exits**, in arrival order; publications never
interleave inside an action's batch (whether staged publications join that
exit's flush or open a following commit is an open question below). Also
**new work**, not an assumed
property: values that change together across capabilities (a rotation
changing insets *and* viewport) must land in one batch — a root-scoped
host-publication transaction, gated
by a named per-host conformance check (the LLP 0034 posture). Coalescing
multiple *distinct* host events into one per-frame commit is deliberately
not promised here; whether it is needed is a Phase 0 measurement question.

**Initial value.** Where the host can answer synchronously (viewport,
scheme, insets on native) the binding starts resolved at first evaluation;
where it cannot (geolocation), the binding starts in its declared
`pending`/default state — the async arm, not an undefined flicker.

**Subscription lifecycle.** Two levels, matching the shipped precedent:
per-root capability instances (owner-disposed with the root) fan out from
**one shared, lazily-installed, refcounted physical host subscription** —
the viewport window listener installs with the first subscriber and
uninstalls with the last. For permissioned sensors the sharing is
load-bearing, not cosmetic: N roots must mean one `watchPosition` session
(one permission prompt, one radio), with per-root signal fan-out. Every
binding is test-overridable (the `?appearance=light` and
`setSafeAreaInsets`-override precedents — Diary 0008 records why: "if a UI
follows ambient OS state, its tests must pin that state").

**The typed escape hatch.** App-defined glue declares itself:

```
host backend = appGlue("backend", { default: "connecting" })
```

with a JS-side `publishHostState("backend", value)`. (This example is
deliberately the classification's *provider connection state* row: `appGlue`
here is the **read-only projection** of LLP 0034's lifecycle axis the
classification allows — the glue publishes what the adapter reports; the app
does not re-own the lifecycle.) Declared in-contract
with a name, type, and default — undeclared names are compile errors — so
the seam stays discoverable instead of becoming an untyped global event bus.
`publishHostState` runs through the same canonicalization, equality, and
batching machinery as host-written bindings — no privileged side door. And
the classification, not the escape hatch, decides what belongs here:
`appGlue` is for low-frequency host-adjacent glue (a connection banner, a
platform quirk flag); async query results go to the resource seam and
high-frequency app data stays in ordinary state — the inventory's migration
column routes exactly one of the six seams through `appGlue` at most.

This subsumes LLP 0029 G9 (geolocation binding) and the binding half of G14
(safe-area; the layout half — "surface bleeds, content insets" — stays with
Exact/Contract layout), and deletes the nowMs-as-invalidation-token
convention.

### D2 — Time as a host concern

The draft claimed that after D1, countdown text would be the only reason
`nowMs` exists. The temporal inventory says otherwise — All Aboard's time
dependencies, verified against the shipped app (two review rounds each
corrected cells here; these are the code's cadences, not the domain's):

| Use | Real cadence / deadline | Kind |
|---|---|---|
| Countdown minutes (board hero, trip screen) | target-relative: flips when `departure − now` crosses a whole minute — predicted times carry seconds, so flips are not wall-minute-aligned | presentation |
| Feed freshness ("Updated …") | minute: one constant "a few seconds ago" bucket for the first minute, then per-minute — never per-second | presentation |
| Clock-time labels | changes with data — and with host timezone changes (a clock-authority input), not with advancing time | presentation |
| Departure expiry / board selection | target-relative: predicted departure + grace window | logic |
| Feed live→stale flip | target-relative deadline: still fresh at exact equality (`now − fetchedAt <= staleAfterMs`); flips strictly after | logic |
| Trip position interpolation | continuous function; today *sampled* at the clock's cadence (the 5 s quantization bucket) — function cadence ≠ sampling cadence | logic |
| Station-art rollover | UTC epoch day (flips at midnight UTC; service-day correctness is registered G13 debt) | logic |
| Route-estimate cache TTL | target-relative deadline — today via an independent `Date.now()`, a one-clock-authority violation | logic |

(The synthetic schedule itself has a rolling hourly horizon and **no
service-day calendar** — a real-GTFS service-day rollover is domain debt
adjacent to G13, not a dependency of the shipped app; the earlier draft
listed it as if it were.)

So D2 is two pieces, and both are needed — with **deadline-driven
invalidation as the shared primitive**, because half the inventory is
target-relative, not periodic:

- **Signal-level**: `now(granularity)` as a built-in signal (`now("minute")`,
  `now("5s")`) for logic that genuinely branches on coarse time, plus
  `invalidateAt(deadline)` for logic that branches at a moment (expiry at
  `predictedDeparture + grace`; staleness strictly after
  `fetchedAt + staleAfterMs` — the predicate is inclusive at the boundary).
  Granularity makes the render cadence an explicit, reviewable choice
  instead of an accidental 1 Hz — and `now("minute")` is sugar for a
  periodic deadline policy, not a privileged wall timer. A shared
  wall-aligned minute tick is the *wrong* semantics for the motivating case:
  countdown and expiry transitions are target-relative, so a wall-minute
  timer fires up to ~59 s late. Consumers whose computed deadlines coincide
  fire in the same frame — which is what wall alignment was trying to buy,
  achieved correctly. Boundary convention: a deadline names the **first
  instant its predicate may differ** — for a predicate that is inclusive at
  its boundary (feed freshness holds at exact equality), that is the first
  representable clock instant *after* the boundary, not the boundary itself.
  The scheduler fires at-or-after the deadline and evaluates with
  `now >= deadline`, so a single wake suffices; an exact-boundary wake that
  would still see the old value cannot occur by construction. Conformance
  tests exercise exact equality and the next clock instant explicitly.
- **Presentation-level**: host-scheduled time text, narrowed to what it
  actually removes — the high-frequency presentation cadence. The leading
  shape (sharper than the draft's `countdown()` node kind): a temporal
  binding that returns **the formatted value plus its next-change deadline**,
  so the scheduler re-evaluates *only that binding* when its output can
  change. That covers bare minutes-as-number (All Aboard's hero is a number
  composed into app typography with a `departed` logic branch — a fixed
  style vocabulary would have missed the RFC's own motivating case),
  relative dates, and relative-age text, without a host-mutated label that
  the inspector cannot see — and its next-change deadline is the *same*
  primitive the signal level schedules on. Host-updated text must remain
  observable to the Exact inspector, the accessibility tree, hydration
  compare, layout (a width-changing countdown re-measures), and the
  deterministic test clock — requirements, not afterthoughts.

**One clock authority, with defined semantics.** Both pieces resolve
against a single injectable clock that owns one deadline queue, with these
rules (previously "needs defined behavior"; these are the behaviors):

- **Wall-clock jumps and timezone/DST changes** re-evaluate every
  outstanding deadline against the new clock — the registered G13 debt
  becomes a testable rule rather than an accident. The authority also
  exposes a **timezone-generation input**: absolute-time formatters (the
  clock-time labels, which schedule no deadline) depend on it and re-fire on
  a timezone change without ever subscribing to an advancing `now`.
- **Background→foreground resume** evaluates missed deadlines once, in
  order, coalesced into one commit — catch-up, not a per-missed-tick replay
  storm.
- **Hydration release** re-evaluates temporal bindings against the live
  clock (the ENG-22563 replay posture the viewport capability already has).
- **Determinism**: the test clock drives the same queue; under a frozen
  clock no deadline fires without an explicit advance (LLP 0027 Phase 0
  proves predictions against a frozen clock; the acceptance suites pin
  ambient state).
- **Ownership**: deadlines are owner-scoped and disposed with their root;
  stragglers like the route-cache TTL's independent `Date.now()` migrate
  onto this authority.

This is the *client UI* clock — deliberately distinct from the data tier's
`RuntimeNow`/ctx-time (LLP 0051), which is a determinism-scoped server
concern. Different clocks, different rules, not unified.

### D3 — Value-completion at the render boundary

The equality landscape today, per layer (the review round's fact table):

| Layer | Equality behavior today | Remaining hole |
|---|---|---|
| Contract state writes | `Object.is` skip (`signals.ts`) | — |
| Contract derive propagation | reference (`Object.is`) | fresh-but-equal composites re-fire dependents (→ D4) |
| DOM mirror, element apply | props-reference gate (ENG-23260) | no value comparison of lowered element state |
| DOM mirror, raw text | string-compared | largely protected |
| Native, element props/style | canonical value diff (`propsEqual`, `collectChangedStyleKeys`) | already protected |
| Native, raw text | unconditional emit per binding re-fire | skip identical text |

D3 closes the two holes:

- **DOM mirror**: shallow value-compare of the element state the mirror
  actually consumes before apply — and that domain is wider than native
  canonical props: `applyProps` reads original props plus DOM-only lowered
  state (input value/checked, image sources, SVG content, tag-specific
  attributes). The comparison must cover the full **DOM-observable
  snapshot**, defined as part of the Exact-side design. Reference equality
  remains the fast path; value equality becomes the safety net. The
  compared values are overwhelmingly small scalars, so the comparison is
  bounded and cheap relative to style application and layout. What it does
  not remove: the mirror's reconciliation walk (see the cost model) — D3
  guarantees no *writes*, not no traversal. And a fully value-equal pass
  **still commits and walks today**: every settled effect flush runs the
  `onFlush` hooks, each mounted root commits on that hook, and every commit
  invokes mirror sync (`signals.ts` → `mount.ts` → `host-ops.ts`). Phase 0
  measures what that residual costs; suppressing empty commits would be
  additional scope, not an assumed behavior.
- **Raw text, all hosts**: compare the incoming string against the node's
  current text in `updateTextContent` and skip on equality — one comparison,
  saving the protocol op, the kernel remeasure (ENG-23161), and the layout
  dirty-mark. Implementation trap for the Exact side: the current code
  assigns `instance.text = newText` *before* encoding — a comparison added
  after that assignment always sees equal and would skip every real update;
  compare first. (The suspense-hidden path shows an in-function skip is
  architecturally safe, and `unhideTextInstance` re-emits via
  `setTextContent` directly, so unhide survives the equality skip.)

**The invariant, stated precisely:** *host-observable-equivalent state emits
no redundant host operations.* Not "nothing visibly changed" — accessibility,
semantic, and structural changes can be non-visual and must still patch.

For native the comparison lives JS-side in the encoder — already the site of
the element value diff — saving protocol bytes as well as host-side work.
D3's comparator and D5's reporting are one implementation with two consumers
(skip mode and report mode), so the dev numbers cannot drift from prod
behavior.

What D3 does **not** do: make an idle tick free. The recompute cascade above
it still runs (see the cost model). D3 guarantees the host boundary is quiet
when values are equal; D1/D2/D4 are what make the app quiet.

### D4 — Derive memoization semantics

At the signal layer: let a derive keep its previous reference when a
recompute is value-equal, so downstream dependents do not re-fire.

**Opt-in first, and honestly scoped.** The draft proposed "shallow by
default"; the review round falsified that against the motivating case:
`boardTrains` returns a fresh object containing fresh arrays of fresh row
objects (`data.ts` — `before: rows.map(withMeta)`), so a shallow comparison
at the result boundary *never* hits. A default change would also alter
observable identity semantics for arbitrary imported-JS values (mutable
nested objects, custom prototypes, comparator errors, old-reference
retention). So:

- `derive x = f(...) memo` / `memo(comparator)` sugar ships first, with a
  documented eligible value domain (plain objects/arrays of scalars,
  `Object.is` per leaf; opt-out per prop).
- For list-shaped composites — the common real case — the answer is
  **keyed structural sharing**, not deeper generic comparison: rebuild the
  collection but recycle row objects that are value-equal by stable key
  (train id), so per-row bindings keep stable references and skip. Sharing
  composes **bottom-up**: if every row is recycled, the containing array
  keeps its reference; if every field of the outer record (arrays included)
  is reference- or value-stable, the outer record keeps its reference — so
  a value-equal `boardTrains` recompute returns the *same* object and
  downstream propagation stops entirely. What still runs regardless: the
  outer derive's own recompute and the keyed comparison itself; what stops:
  every downstream re-fire (`each` reconciliation sees the same array;
  recycled rows' item signals skip on `Object.is`). Whether that ships as a
  `memoRows(key)` helper or compiler support is open.
- Composite derives that opt into nothing are still safe at the host
  boundary via D3; they just pay the recompute.

Independent of adoption, the authoring docs must state plainly: *under
reference-based propagation, a derive's return identity is part of its
contract — return the same object when nothing changed.* All Aboard learned
this from renderer source; the next author should learn it from the manual.

### D5 — Update-economy instrumentation

The draft proposed extending `dataflow-inspector.ts`'s
`changed = !Object.is(before, after)` into the profiler. Correction from the
review round: that computation is action-scoped bookkeeping
(`recordContractStateWrite` returns unless an action is currently recording)
— it observes no derives, no host ops, no commits. The renderer's existing
telemetry (`inspector-runtime.ts` `changedViews`) counts changed views but
cannot see equal-but-attempted updates. The profiler is real work, phased:

- **Phase 0 — instrumented reproduction (first, before any D lands).**
  Counters over one representative commit stream: derive recomputes, effect
  re-runs, host-update attempts vs. value-equal no-ops, same-text writes,
  DOM `applyProps` calls, mirror-traversal visits, protocol ops/bytes,
  layout requests, frame timing.
  Run on All Aboard, web and iPhone, with and without the two mitigations.
  The JS half is S, not M: the signal layer already exposes global and
  per-node recompute/effect churn (`reactiveChurn` and per-node meta in
  `signals.ts`) — Phase 0 wires those to the host-boundary counters. The
  native layout/thread trace is the M half.
  This produces the measured baseline this RFC currently lacks (the draft's
  "638 nodes re-applied, 96.7% value-equal" was illustrative, not measured),
  confirms the per-host mechanism split empirically, and answers the
  kernel-thread question with a trace instead of an assertion.
- **Phase 1 — the productized profiler.** Per-commit report behind the
  existing devtools. An honesty note the review round forced: node
  provenance (`contract/src/runtime/provenance.ts`) carries component,
  source line, and expression **for rendered nodes and their terminal
  binding expressions** — but derives instantiate as *unlabeled*
  `ownedComputed`s with generic `computed:N` graph ids, so no existing join
  reaches from a host-update attempt back to `themePalette`. The compiler
  already holds the ingredients (derive names and spans — it wraps each
  derive body in an `errorLocus`); Phase 1's substrate work is
  compiler-authored labels on signals/computeds/effects plus a causal ID
  carried through host-update attempts, so the report names **both** the
  terminal binding (from node provenance) and the upstream source — where
  "top source" means the first changed derive on the causal chain, with
  allocation churn reported separately:

  > commit #412: 638 host-update attempts, 96.7% value-equal.
  > Top sources: themePalette (312 attribute attempts),
  > boardTrains (183 text attempts).

  Threshold-triggered console warning in dev (à la why-did-you-render), full
  table in the inspector. Effort M, not S — the draft underestimated it, and
  the labeling substrate is most of the M.
- **The conformance complement (S, independent) — two checks, not one.**
  (1) A
  compile-time lint for declare-and-ignore parameters — `themePalette(_tick?)`
  takes a tick it never reads — covering both derive definitions **and**
  view expressions (`text mapsAppLabel(nowMs)` is the same convention at the
  view edge). Statically detectable today, no runtime, and it would have
  flagged every instance of the *tick convention* in this app. (2) The
  **purity-conformance check** from the hidden-reads note: a module/host
  read inside a helper declared (or defaulted) `pure({ depends: 'args' })`
  is a compile-time or dev-mode diagnostic. It must see **transitive**
  reads — the scheme readers reach module state through the private
  `isDark()`, and the location-value readers reach it two calls deep
  (`walkBikeLine` → `walkBikeSummary` → `getUserLocation`) — so it is
  either transitive call-graph analysis or the dev-mode dynamic form, which
  observes reads naturally. This is what catches the
  tick-free and genuinely-time-branching hidden readers (`serviceTint`,
  `delayColor`, `feedFreshness`, `feedSourceBadge`) that no parameter lint
  can see — and the undeclared-helper hole.

### Sequencing

Phase 0 instrumentation (S JS counters; M native trace) → D5 conformance
checks + D4 docs (S) → D3 text-skip (S) →
D2 signal-level (`now(granularity)` + `invalidateAt`, M) → D1 host bindings
(M, subsumes two
LLP 0029 gaps) → D3 mirror value-compare (M) → D2 presentation-level +
D4 `memo` (M) → D5 Phase 1 profiler (M). Measurement first because it
baselines everything after it; the raw-text skip early because it is one
comparison with an outsized native payoff.

### Ownership and landing

D1–D5 land almost entirely in Exact (Contract grammar and runtime, renderer,
devtools). LLP 0021 is explicit that Snapback does not own Contract language
semantics or renderer internals and that Exact-side work must be recorded as
an explicit dependency. So: **this RFC is the Snapback-side evidence and
consumer requirements**; the normative designs land as Exact LLPs (the
host-capability line, including the kernel-fed native viewport wiring, is
already Exact LLP 0292) with this document and
Diary 0008 as the motivating record. Accepting this RFC means agreeing to the
requirements, the classification, and the gap-closure plan — not claiming the
implementation here. Each D-item's Exact counterpart gets linked from the
G15 register entry as it is filed.

**Compatibility and rollback.** Nothing here changes semantics for existing
apps by default: D1/D2 are additive grammar; D4 `memo` is opt-in; D5 is
dev-only (zero production cost is itself a gate). The one behavior change is
D3's skip of value-equal host operations — it ships behind a
per-path revert flag until its conformance gates hold on both hosts, so a
comparator bug degrades to today's redundant-op behavior, not to missed
updates.

## Alternatives considered

- **Fine-grained signals into the view (Solid-style).** Per-binding
  subscriptions would dissolve the composite-identity problem by
  construction. Rejected as a re-architecture: Contract's compile-to-dataflow
  model already gives per-binding *effects* at the view edge; the identity
  problem lives in the composite derives feeding them, and it is cheaper to
  fix at the boundaries (D3) and the derive layer (D4) than to rebuild the
  middle.
- **Userland memo stdlib plus documentation, nothing else.** The do-least
  option. Rejected by LLP 0016's standard: glue every app must copy is a gap,
  not a solution — this RFC exists because two such conventions already
  shipped.
- **Always-value-compare at the signal layer (deep).** Rejected: unbounded
  comparator cost on arbitrary app values and observable semantic change as a
  silent default. Bounded shallow comparison at the render boundary (D3) plus
  opt-in memoization (D4) capture most of the value at bounded cost.

## Acceptance gates

The ENG-24189 web baseline and raw counters live in
`demos/all-aboard/measurements/`. The physical-iPhone/thread trace remains open,
so the hardware-independent count gates below are fixed while native timing is
not yet claimed.

- **D3**: a commit in which every element's DOM-observable snapshot, style
  leaf, and text string is value-equal — with unchanged topology and child
  order — produces zero DOM mutations (web mirror) and zero protocol ops
  (native encoder) — conformance-tested on both paths. The suite is
  **two-sided**: a changed text produces exactly one text op, and a
  suspense-hidden text updated while hidden re-emits on unhide — so an
  implementation with the compare-after-assign bug (which suppresses real
  updates too) cannot pass. (The mirror's
  traversal residual is measured by Phase 0, not gated by D3.) The measured
  all-equal `current` wave starts at **127 redundant DOM applies, 158 same-text
  attempts, 160 protocol ops / 3,398 bytes, one layout request, and 577 mirror
  visits**. D3 takes the first five counts to zero; the 577-node walk remains
  measured residual.
- **D1**: scheme, insets, and geolocation flow through `host` bindings in All
  Aboard; the six-seam inventory table above deletes to at most the typed
  `appGlue` entries; G9 and G14's binding half close in LLP 0029. Behavioral
  conformance, per host: delivering a value-equal fresh record N times
  produces zero propagations after the first; correlated capabilities (a
  rotation changing insets and viewport) publish in one commit; and — the
  hidden-reads backstop — flipping scheme, location, and backend state
  independently under a frozen clock updates every affected reader in the
  inventory.
  All named checks in the LLP 0034 posture.
- **D2**: no derive or view expression takes a time parameter it does not
  branch on; every remaining temporal dependency declares its granularity or
  deadline; countdown/freshness text updates without waking the app
  dataflow, and target-relative transitions (countdown minute flips,
  departure expiry, feed staleness) fire at their deadlines — not up to a
  minute late on a wall-aligned tick. In the baseline, `current` still wakes
  four times in 20.25 s and runs 304 effects per active wave; the migrated
  idle window has **zero periodic app-dataflow waves** (declared logic
  deadlines and independently injected host events are the only exceptions).
- **D4**: a value-equal `boardTrains` recompute under keyed structural
  sharing returns the same outer reference and produces zero downstream
  re-fires in the D5 counters. A one-row-changed recompute keeps every other
  row's reference and re-fires only that row's bindings *among the keyed
  rows* — the outer record necessarily changes identity, so direct
  outer-field observers may still re-fire (bounded at the host boundary by
  D3).
- **D5**: with the quantization mitigation reverted, the Phase 1 profiler on
  All Aboard reports (near-)zero value-equal host ops per tick after D1–D3 —
  and the default console warning fires at **at least 100 host attempts with
  at least 80% value-equal in one commit** (the measured `current` wave is 285
  at 100%). The profiler adds at most **1 ms or 10% (whichever is larger) to
  p95 commit time** against the reporter-disabled dev control, keeps this
  fixture's frame p95 at or below 11 ms, and adds zero eager production
  modules/counters. Attribution is itself gated: a fixture with a known
  derive→binding diamond reports both the terminal binding and the
  first-changed upstream derive correctly under fan-in.

## Non-goals

- Redesigning the signal architecture — the `Object.is` state-write skip is
  correct and is what the quantization mitigation already leans on.
- A general animation/transition system, gesture primitives (LLP 0029 G1,
  ENG-24056), or the URL-open capability — adjacent host gaps, separately
  registered.
- Unifying the UI clock with the data tier's `RuntimeNow`/ctx-time
  (LLP 0051) — different determinism regimes by design.
- Owning renderer internals in Snapback (LLP 0021's boundary; see Ownership).
- Prescribing exact syntax — the notation above is illustrative; the
  ownership boundaries (host owns time and device state; render boundary owns
  value equality) are the proposal.

## Open questions

- **Comparator domain (D3/D4):** the exact value domain and equality relation
  the framework can promise across styles, arrays, nested records, event
  props, and mutable values — and per-prop opt-out shape.
- **D1 negotiation surface:** per-root capability bag (the `viewport`/
  hydration path) vs. a declared host-binding manifest — and how an
  unimplementing host resolves: declared default vs. a distinct
  `unavailable` arm like the async `stale` sugar. (This repo's LLP 0005
  leaves the capability-artifact split open; that question and this one
  should resolve together.)
- **D1 initial-value timing:** which bindings are synchronous-at-first-
  evaluation on which hosts, and whether the async-interim state is
  observable to derives (it should be, as a typed arm, never as a flicker).
- **D1 frame coalescing:** whether multiple *distinct* host events inside
  one frame ever need coalescing into one commit (not promised here; a
  Phase 0 measurement question).
- **D1 multi-root sensor options:** how roots with incompatible sensor
  options (geolocation accuracy, interval) negotiate the one shared
  physical watch — widest-demand merge, per-option watches, or a declared
  error.
- **D1 staging drain point:** whether a publication staged behind an active
  action batch joins that batch's exit flush or opens a following commit —
  and the ordering fixture that pins whichever is chosen.
- **D4 outer-record granularity:** whether the changed-row guarantee stays
  limited to keyed row bindings (outer-field observers re-fire on any row
  change, D3-bounded) or outer records grow field-level signals.
- **D2 shape:** deadline-returning temporal binding vs. host-interpolated
  text vs. node kinds — and how the deadline queue treats near-coincident
  deadlines (same-frame coalescing window). Wall-vs-subscription alignment
  is resolved: deadlines are target-relative; periodic policies are sugar.
- **Kernel-side confirmation:** Phase 0 must verify by trace where native op
  apply and remeasure time actually goes; the pinned sources end at the
  encoder.
- **D5 columns:** report recompute count and re-fire count separately from
  host-op count, so allocation churn (a D4 memo hit that discarded a fresh
  object) stays visible.
- **Exact LLP mapping:** which Exact LLP numbers own the normative designs
  for D1/D2/D3, and what conformance suite (the LLP 0034 posture: named
  checks, per-host) gates them.

## Status

Review — moved from Draft by the author on 2026-07-11 after the four-round
loop below concluded with both reviewer families satisfied.
Written from the All Aboard scroll-jank investigation
([Diary 0008](../diaries/0008-all-aboard.diary.md), 2026-07-10/11 entries).
Reviewed 2026-07-11 under the LLP-process review loop, four times. Round 1
(Claude fresh-session and GPT-5 Codex gpt-5.6-sol ultra, under
`llp/reviews/0052-*`) falsified the draft's central "reference-based
dirtiness on every host" claim against the pinned `@exact/renderer@0.1.2`
sources (native element props were already value-diffed; the native hole is
raw-text re-emits); the same-day rewrite rebuilt the mechanism, D1, D2, D3,
and D5 on the corrected fact base. Round 2 (same two families, fresh
sessions, same day) verified the corrected mechanism end-to-end and split:
Claude satisfied with pinpoint minors; Codex not satisfied, with majors on
the newly written surfaces — D1's record-value equality and
batching/ordering mechanics, factual cells in both inventories, D2's
wall-timer semantics, and D5's attribution substrate. The round-2 revision
(same day) addressed the union: per-capability canonicalization and the
two-level subscription model in D1, the deadline-driven D2 with corrected
inventory, the D5 labeling substrate, the D4 composition rule and gate, the
D3 snapshot domain and trap notes, corrected citations (Exact LLP 0292; the
practiced-idiom evidence replacing the LLP 0020 cite), and companion errata
(Diary 0008 erratum; the `data.ts` `@ref LLP 0052` comment). Round 3 (same
two families, fresh sessions, same day) verified the round-2 surfaces and
split again: Claude satisfied (three pinpoint prose defects); Codex not
satisfied on one remaining major — the hidden-reader inventory was still
incomplete (`delayColor`, `locationIndicatorColor`, `locationHint`;
`feedSourceBadge`/`backendStatusNote` undeclared in contract-meta) and the
declare-and-ignore lint provably cannot see tick-free or time-branching
hidden readers, so clock deletion could strand them stale. The round-3
revision (same day) rebuilt the hidden-reads audit into the four-class
inventory, added the purity-conformance check (D5) and the frozen-clock
flip backstop (D1 gate), and applied both reviews' precision minors
(per-root flush wording and publication staging; deadline boundary
convention, timezone-generation input, sampling-vs-function cadence;
two-sided D3 gate; narrowed D4 gate; the `appGlue`-as-0034-projection
framing; the corrected D5 example and attribution fixture; the
every-node-per-commit mirror cell; the narrowed palette comment). Round 4
(same two families, fresh sessions, same day) verified the round-3 revision
and **both returned SATISFIED** — no blocking or major concerns remain.
Their remaining pinpoint minors (the header/Status counts; the
deadline-boundary encoding for inclusive predicates; staging labeled a
proposed D1 rule with its drain point an open question; the
value-equal-commit question answered from the pinned runtime; the
purity-conformance check's transitive scope and defaulted arm; "every
affected reader" in the D1 gate; the location seam's value-side readers and
`safeAreaInsets` scoped into the audit) were applied the same day as the
final author's-discretion pass, which both reviews stated needs no further
cross-family round. The document is ready for the author's status decision.
Implementation is tracked as ENG-24188 (umbrella) with one child ticket per
sequencing stage (ENG-24189 Phase 0, ENG-24191 conformance checks + D4 docs,
ENG-24193 D3 text-skip, ENG-24194 D2 signal-level, ENG-24199 D1 bindings,
ENG-24200 D3 mirror, ENG-24202 D2 presentation, ENG-24205 D4 memo,
ENG-24207 D5 profiler).
The userland
mitigations are live in `demos/all-aboard/surfaces/contract/`; this RFC is
the framework-side closure that would let them (and the six-seam device-glue
inventory) be deleted. Registered as G15 in
[LLP 0029](./0029-all-aboard-gap-closure.plan.md).
