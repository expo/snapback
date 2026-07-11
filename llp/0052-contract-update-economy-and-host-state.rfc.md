# LLP 0052: Contract update economy and reactive host state

**Type:** RFC
**Status:** Draft
**Systems:** Contract/Exact, Developer experience, Demo apps
**Author:** Claude (Fable 5) / Charlie Cheever
**Date:** 2026-07-11
**Related:** LLP 0029, LLP 0027, LLP 0021, LLP 0034, LLP 0005, Diary 0008

## Summary

All Aboard shipped a scroll-jank bug whose root cause was architectural, not
app-local: **the framework's paved-road idioms compose into worst-case update
patches**. A 1-second UI clock threaded through every derive (the house
"nowMs cache-buster" convention), derives returning fresh-but-value-equal
objects each call, and props-reference-based change detection in the
renderer meant the UI thread re-applied essentially the whole screen every
tick — on every host, regardless of the JS VM running off-thread. The demo
mitigated it in userland (clock quantization exploiting the signal layer's
`Object.is` skip; palette singletons restoring reference stability), but
every mitigation is a convention the next app must rediscover.

This RFC proposes five framework changes, ordered by leverage:

1. **Reactive host/device state** — a first-class binding for
   device-capability values (color scheme, safe-area insets, geolocation,
   app-defined glue state), replacing the module-state-plus-clock hack.
2. **A time primitive** — host-side countdown/clock text plus a
   coarse-grained `now(granularity)` signal, so wall-time leaves the app
   dataflow entirely.
3. **Value-based dirtiness at the patch boundary** — shallow value
   comparison of canonical props before encode/apply, so value-equal
   renders produce empty patches by construction.
4. **Derive memoization semantics** — keep the previous reference when a
   recompute is value-equal, and document that a derive's return identity
   is part of its contract.
5. **A dev-mode patch profiler** — surface "N% of applied props were
   value-equal this commit; top offender: X" so the next app is nudged
   before a human feels the jank.

Items 1–2 remove the reason the pathology exists; item 3 makes it
impossible to ship; items 4–5 make the model legible while 1–3 land.

## Motivation

### The incident

Diary 0008 (2026-07-11): scrolling the All Aboard board felt janky on a
physical iPhone and on desktop web. The proximate mechanism, verified in
the renderer source:

- The app ticks `nowMs` at 1 Hz so countdowns advance — and, by the house
  convention, so that *module-state glue* (geolocation, maps preference,
  color scheme, backend attach state, safe-area insets — five independent
  reinventions in one app) gets re-derived at all.
- Nearly every derive therefore depends on `nowMs`. Object-returning
  derives (`themePalette`, `boardTrains`, `getSelectedStation`, …) return
  **fresh objects each call** even when every value is identical.
- The renderer's change detection is **props-reference-based**: the DOM
  mirror's fast path skips a node only when `appliedProps.get(element) ===
  element.originalProps` (`dom-mirror.ts`, the ENG-23260 fast path —
  "same props reference means nothing to lower or apply"). A
  fresh-but-equal props object is indistinguishable from a real change.
- Result: every tick marked ~the whole tree dirty, and the UI thread
  re-applied props across it once per second. Threading the VM off the UI
  thread (the Ibex/Hermes architecture) does not help: the *patch* is
  applied on the UI thread, and the patch was the whole screen.

### Why this is a framework problem, not an app bug

Each ingredient is the recommended idiom:

- **Pure helpers returning objects, called from view expressions** is the
  Contract authoring model (LLP 0027, Diary 0008 throughout). Nothing
  tells an author that return *identity* is load-bearing.
- **The nowMs cache-buster** exists because glue code has no way to
  invalidate a derive. Contract state is component-owned; device
  capabilities live in module state behind setter functions
  (`setDeviceLocation`, `setColorScheme`, `setSafeAreaInsets`,
  `setBackendState`, `setMapsApp` — five instances in one demo, and
  LLP 0029 G9/G14 register two of them as standing gaps). The ticking
  clock is the only signal that reaches everything, so it became the
  universal invalidation token — making *everything* time-dependent.
- **Reference-based dirtiness** is a sound performance choice at the
  mirror layer (ENG-23260 fixed the opposite problem: re-lowering every
  node on every commit). It only becomes pathological when combined with
  the two idioms above — and the framework currently combines them by
  default.

When the paved road and the pathological case are the same road, the
framework owns the fix.

### What userland mitigation looked like (and why it is not the answer)

Shipped in All Aboard (Diary 0008, 2026-07-11):

- **Clock quantization**: the ticker writes `now() - now() % 5000`; the
  signal layer's `Object.is` equality-skip (`signals.ts`) turns 4 of 5
  ticks into no-ops. Frequency treated, size untreated — the every-5s
  render still re-applies the tree.
- **Palette singletons**: `themePalette` returns per-scheme module
  constants, restoring reference stability for the single most-read
  derive.

Both work. Both are conventions an author must know, apply per-derive, and
re-derive from renderer source to understand. LLP 0016's standard applies:
glue that every app must copy is a gap register entry, not a solution.

## Design

### D1 — Reactive host state (`host` bindings)

A declared Contract binding for host/device values, symmetrical with
`query` bindings for server data:

```
host scheme = colorScheme()          // 'light' | 'dark', reactive
host insets = safeAreaInsets()       // {top,right,bottom,left}, reactive
host location = geolocation({ mode: "whenAvailable" })
```

Semantics: the host (web glue layer, native kernel) owns delivery; a
change invalidates exactly the derives that read the binding — no clock
involved. The existing capability manifest declares which bindings a host
implements, so a missing capability is a *declared* gap (the LLP 0029
posture) instead of silently-stale module state. An escape hatch
(`host x = appGlue("name")` with a JS-side `publishHostState("name",
value)`) covers app-defined glue like All Aboard's backend attach state,
so the seam stops being reinvented.

This subsumes LLP 0029 G9 (geolocation binding) and the binding half of
G14 (safe-area), and deletes the nowMs-as-invalidation-token convention.

### D2 — Time as a host concern

Two pieces, either alone valuable:

- **Formatting-level**: `text countdown(timestampMs, style)` /
  `text clock(timestampMs, style)` node kinds the *host* keeps current.
  The countdown text updates locally (a text-node write on the UI thread,
  or a native label timer) with **zero renders in the app dataflow**. This
  is the All Aboard hot path: after D1, countdown text is the only reason
  `nowMs` exists.
- **Signal-level**: `now(granularity)` as a built-in signal
  (`now("minute")`, `now("5s")`) for logic that genuinely branches on time
  (service-day rollover, staleness windows). Granularity makes the render
  cadence an explicit, reviewable choice instead of an accidental 1 Hz.

### D3 — Value-based dirtiness at the patch boundary

Before a node's canonical props are encoded (native protocol) or applied
(DOM mirror), shallow-compare values against the last-applied set; skip on
equality. Canonical props are overwhelmingly small scalars — strings,
numbers, booleans — so the comparison is bounded and cheap relative to
style application, layout, or protocol serialization + UI-thread apply.
Reference equality remains the fast path; value equality becomes the
safety net. With D3 in place, a render in which nothing visibly changed
produces an empty patch **by construction**, and D1/D2 become
optimizations rather than correctness-of-performance requirements.

### D4 — Derive memoization semantics

At the signal layer: when a derive recomputes to a value-equal result
(configurable comparator, shallow by default for plain objects/arrays),
keep the previous reference so downstream dependents do not re-fire.
Surface as `derive x = f(...) memo` sugar first if a default change is too
risky. Independent of adoption, the authoring docs must state plainly:
*under reference-based dirtiness, a derive's return identity is part of
its contract — return the same object when nothing changed.* All Aboard
learned this from renderer source; the next author should learn it from
the manual.

### D5 — The patch profiler (dev-mode nudge)

The runtime already computes `changed = !Object.is(before, after)` in
`dataflow-inspector.ts`. Extend it into a per-commit report behind the
existing devtools:

> commit #412: 638 nodes re-applied, 96.7% value-equal.
> Top sources of equal-but-fresh props: themePalette (312 nodes),
> boardTrains (183), getSelectedStation (58).

Threshold-triggered console warning in dev (à la React's
why-did-you-render), full table in the inspector. This is the cheapest
item and the one that converts every future instance of this class from
"felt on a phone after weeks" to "seen in the console on the first run."

### Sequencing

D5 (S) → D2 formatting-level + D4 docs (S–M) → D1 (M, subsumes two
LLP 0029 gaps) → D3 (M, protocol + mirror) → D2 signal-level and D4
runtime default (M, semantics change, wants a deprecation note). D5 first
because it measures the others' effect.

## Non-goals

- Redesigning the signal architecture — the `Object.is` state-write skip
  is correct and is what the quantization mitigation already leans on.
- A general animation/transition system, gesture primitives (LLP 0029 G1,
  ENG-24056), or the URL-open capability — adjacent host gaps, separately
  registered.
- Prescribing exact syntax — the notation above is illustrative; the
  ownership boundaries (host owns time and device state; patch boundary
  owns value equality) are the proposal.

## Open questions

- **Comparator depth (D3/D4):** shallow value equality catches the
  observed cases (token objects, row objects of scalars). Are there
  legitimate deep-object props where shallow comparison thrashes, and is
  opt-out per prop needed?
- **D1 capability negotiation:** should a `host` binding on an
  unimplementing host resolve to a declared default (current demo
  posture) or a distinct `unavailable` arm like the async `stale` sugar?
- **D2 formatting scope:** is host-side countdown text worth a node kind,
  or should it be a general "host-interpolated text" primitive (also
  useful for e.g. relative dates)?
- **Where does D3 live for native** — the JS-side encoder (compare before
  serialize, saving protocol bytes too) or the kernel apply path (simpler,
  saves only UI-thread work)? Encoder-side looks strictly better.

## Status

Draft. Written from the All Aboard scroll-jank investigation
([Diary 0008](../diaries/0008-all-aboard.diary.md), 2026-07-10/11 entries)
with the mechanism verified against the pinned `@exact/renderer@0.1.2`
sources. The userland mitigations are live in
`demos/all-aboard/surfaces/contract/`; this RFC is the framework-side
closure that would let them (and the five-fold device-glue seam) be
deleted. Registered as G15 in [LLP 0029](./0029-all-aboard-gap-closure.plan.md).
