# LLP 0257: Activity-scoped presence convenience

**Type:** RFC
**Status:** Implemented
**Systems:** React, React/Expo, Ephemeral state, Client integration, Developer
experience, Guide
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-15
**Revised:** 2026-08-15 (implementation reconciliation, landed with the
implementation: `excludeSelf?: boolean` restored to the public options
(default `true` removes only the `selfKey` entry; `false` opts out); error
class 1 pinned to preserve a previously admitted, unexpired generation
until its original deadline — a failed thunk refresh neither extends nor
withdraws it; status → Implemented). 2026-08-15 (r7, super-refine round-6
response, applied at
loop close and unreviewed as a delta: a fifth error class added for
lifecycle-observation failure in the Expo wrapper with an explicit
refusal projection; the gated admission pinned to an internal
captured-value seam so deferred admission never re-evaluates the thunk).
2026-08-15 (r6, super-refine round-5 response: hook and
provider pinned to one shared resolved lifecycle source honoring injected
`environment.appState`/`resolveAppState` with the default resolver as the
uninjected fallback; admission gated until lifecycle observation is
established so setup-window transitions cannot leave stale intent; the
`idleMs` refusal carrier named as the exported `SnapbackDiagnosticError`).
2026-08-15 (r5, super-refine round-4 response: the error
algebra's cardinality made class-specific — classes 1/2/4 once per failed
invocation, class 3 once per distinct observed transition; the invalid
`idleMs` carrier pinned as a typed hook-render throw outside the runtime
algebra; the Expo wrapper pinned to sample `AppState.currentState` at
async listener attach). 2026-08-15 (r4, super-refine round-3 response: `idleMs`
refusal made unconditional in every build; admission-refusal class restated
as the base publish's synchronously created promise rejection; transport
`onError` guarantee scoped to distinct observed publisher transitions;
thunk throws wrapped into a typed helper diagnostic; the Expo AppState
doorway pinned to the `@expo/snapback-expo` facade with the demo migration
importing it). 2026-08-15 (r3, super-refine round-2 response: complete error
algebra pinned incl. synchronous admission refusals, thunk throws, and
rejected-withdrawal visibility; Expo background-withdrawal mechanism pinned
to a helper-owned AppState listener with no ordering requirement; `idleMs`
admission domain pinned; demo TTL figure corrected to the declared 15 s;
churn-diagnostic misattribution replaced with the real rate-refusal
consequence). 2026-08-15 (r2, super-refine round-1 response: renewal
ownership corrected to the provider-owned heartbeat, activity model pinned
as an absolute deadline with a generation fence, scope-change reset pinned,
value-thunk sampling pinned to touch-time, result/error surface closed over
the base presence state, Expo background/resume hazard addressed, OQ1/OQ3
closed)
**Related:** LLP 0013, LLP 0061, LLP 0107, LLP 0114, LLP 0247

## Summary

The canonical presence machinery works: `useSnapbackPresence` gives a React
app a provider-owned room with managed-intent publication, a provider-owned
heartbeat, TTL bounds, and cleanup ownership (LLP 0107). But the most common
ephemeral pattern — **"announce while the user is active, withdraw after idle
or unmount"** (typing indicators, "editing…" badges) — is not a surface
primitive. Every app composes it by hand from observer-mode
`publish`/`delete`, an app-owned idle timer, and withdrawal choreography.

Because the provider heartbeat refreshes an admitted entry indefinitely while
the component is mounted and healthy, **withdrawal choreography is the whole
product**: the hard part is not keeping the entry alive but taking it down at
the right moments — idle, explicit clear, unmount, scope change, and (on
Expo) app backgrounding. This RFC proposes one small client-side convenience
— an *activity-scoped publication*: the caller reports activity ticks; the
helper owns exactly the activity deadline and the withdrawal choreography,
and owns **no renewal cadence** — renewal stays wholly with the provider.

## Motivation

The messaging demo is representative of what every app writes today. The
choreography is split across two files: `useTyping`
(`demos/messaging-snapback/src/lib/useTyping.ts`) wraps observer-mode
`publish`/`delete` and self-filtering, while the three-second idle timer and
the clear-on-send calls live in the conversation screen
(`demos/messaging-snapback/src/app/conversation/[id].tsx`); nothing clears on
blur. Each app must:

- wire an idle timer to `delete()` and remember every clear site (send,
  clear, navigate);
- know that a missed `delete()` on a mounted, connected component does not
  age out at TTL — the provider heartbeat refreshes the entry indefinitely,
  so a stuck indicator persists until unmount or connection loss (TTL is the
  backstop only after connection/process loss, per LLP 0013);
- filter self out of the entry list;
- avoid the anti-pattern of app-owned heartbeat intervals
  (`guide/clients/react.md`).

None of these steps is hard, but each is a place to get the lifecycle subtly
wrong, and the composition is identical across apps. Agent-authored apps in
the Clique evaluations reproduce it every time — exactly the friction the
guide program (LLP 0061) exists to eliminate.

## Design

A client-side hook, `useSnapbackActivityPresence`, in
`@expo/snapback-react` (the Expo binding re-exports it), specified as a thin
composition over `useSnapbackPresence` in **observer mode** (`value: skip`
internally, imperative fenced `publish`/`delete`). No wire, server, or
schema changes. The base hook is untouched; its declarative and imperative
modes remain closed as shipped.

```ts
const presence = useSnapbackActivityPresence(ephemeral.typing, {
  scope: { conversationId },
  value: () => ({ userHandle: self, name }), // evaluated on each touch()
  idleMs: 3_000,          // withdraw this long after the last touch()
  ttlMs?: number,          // per-publish TTL; default = collection default
  excludeSelf?: boolean,   // default true: peers omits the selfKey entry
  onError?: (diagnostic) => void,
});
// presence: { status, active, touch, withdraw, peers, publisher,
//             connection, diagnostic, lastError }
```

`idleMs` admission domain: a finite safe integer with `250 <= idleMs <=
2_147_483_647` (the host 32-bit timer bound). Values outside the domain —
including `0`, negatives, `NaN`, `Infinity`, and non-integers — are an
**unconditional diagnostic refusal in every build**, mirroring the base
hook's always-on TTL admission validation (which is not development-gated);
development builds may add extra reporting but never differ in outcome.
There is no silent clamp and no chunked scheduling for longer deadlines, so
an illegal value can never degrade into a platform-coerced immediate timer.
The refusal's carrier is the exported **`SnapbackDiagnosticError`**
(recognized by `isSnapbackDiagnosticError`, both re-exported by the React
package today), **thrown from the hook render itself** — invalid
configuration fails before any result exists, so it sits outside the
runtime error algebra below (which covers per-action failures on a
constructed hook), mirroring the base hook's descriptor validation
posture.

### Activity model: absolute deadline plus generation fence

- `touch()` records an absolute wall-clock deadline `now + idleMs`,
  increments an activity generation, evaluates the `value` thunk, and calls
  the base `publish` with the resolved TTL. The provider treats an unchanged
  canonical value/TTL pair as a local no-op, so per-keystroke `touch()` is
  cheap; a changed value republishes once. All heartbeat/renewal scheduling
  is provider-owned; the helper schedules **no** republish cadence.
- The idle timer firing checks both the activity generation and the absolute
  deadline before withdrawing, so a canceled-but-queued timeout can never
  withdraw a newer `touch()`, and a timer that slept through OS suspension
  withdraws correctly late rather than never. Withdrawal uses the base
  `delete()`, which is fenced per LLP 0247 §D3 (`(scopeEpoch, entryVersion)`
  expectations; a `superseded` outcome cannot delete a successor); peer
  visibility of a withdrawal is bounded by the §D3 withdrawal-visibility
  deadline (at most TTL/2).
- `active` means: the local activity deadline is armed (unexpired local
  intent). It is independent of publisher acknowledgment; `publisher`
  reports admission/acknowledgment state.
- `withdraw()` — immediate explicit withdrawal (message sent, editor
  cleared). Unmount, room-identity change, and provider disposal also
  withdraw, under LLP 0107's cleanup-ownership rules (Strict Mode
  double-invoke safe; no publish after dispose).

### TTL

The helper publishes with the collection's generated default TTL unless the
caller passes `ttlMs` (bounded to the shipped `[500ms, maxTtlMs]` admission
range). There is **no** constraint between `idleMs` and TTL — any `idleMs`
is legal because the provider heartbeat sustains the entry. TTL's role here
is the ghost-window bound after a lost withdrawal or process loss. The demo
migration is a deliberate behavior change: `useTyping` publishes with the
collection's declared `maxTtlMs` (15 s in the messaging demo's schema; 30 s
is only the paved-path ceiling when a collection omits it); the migrated
demo takes the collection default (6 s there), tightening the ghost window.

### Value semantics

The thunk is evaluated on each `touch()` only. Admitted bytes are never
re-evaluated by the provider heartbeat (LLP 0107: heartbeats replay the
admitted value and never call back into application code), so a value change
propagates on the next `touch()` and not before; a value change without an
activity tick is intentionally ignored. Volatile thunk fields (timestamps,
counters) defeat the unchanged-pair no-op and turn every tick into a real
wire publish; at keystroke rates that ends in rate refusal surfacing as a
`publish-error` suspension (the descriptor-identity churn diagnostic does
not apply here — the helper's internal descriptor is stable). The guide
page will carry this warning. A `touch(value?)` override is
deferred (see Resolved and deferred questions).

### Scope identity and scope change

Room identity follows the base hook: (provider instance, reference,
normalized content-based scope). Content-equal inline scope objects are the
same room; fresh object literals per render are fine. On a true identity
change (reference, provider, or normalized scope), the old room's intent is
withdrawn and **activity resets**: the new room starts withdrawn and stays
withdrawn until the next `touch()`. Activity never migrates across rooms —
typing in conversation A must not paint an indicator into conversation B on
navigation.

### Result and error surface

The result is a closed type that passes through the base presence state
rather than hiding it: `status` (`pending | resyncing | ready | stale |
error | unsupported`), `connection`, `publisher`, and `diagnostic` come from
the base hook; `peers` is the base `entries` with the self connection's
entry (`selfKey`) removed. An `unsupported` or `error` binding is therefore
distinguishable from an empty room — capability refusal is never silently
`peers: []` (LLP 0013's observable-refusal posture).

**Error algebra.** There are five failure classes, every one observable
through the same two channels: `onError(diagnostic)` with class-specific
cardinality — **classes 1, 2, and 4 fire once per failed invocation;
class 3 fires once per distinct observed publisher transition; class 5
fires once per terminal lifecycle-observation failure** — and the
helper-owned `lastError` field (a `SnapbackDiagnostic | null`, distinct
from the base passthrough `diagnostic`), which retains the most recent
failure until the next successful admission or withdrawal clears it. `touch()` returns `void` and never
throws; `withdraw()` returns a `Promise<void>` that always resolves once
the withdrawal attempt settles (its failure, if any, is reported through
the channels, not by rejection).

1. **Value-thunk throw** — caught by the helper; no publish is attempted.
   The thrown value is wrapped into a typed helper diagnostic (a stable
   `SNAPBACK_REACT_ACTIVITY_*` code via the existing error-serialization
   path) so `lastError` remains a `SnapbackDiagnostic`, never untyped. A
   thunk failure on a `touch()` while a previously admitted generation is
   still unexpired preserves that generation untouched — armed until its
   original deadline, neither extended nor withdrawn — so a transient
   thunk bug cannot silently tear down live intent.
2. **Admission refusal** — the base observer `publish` is `async` and runs
   admission before any await, so a refusal (TTL/value bounds, payload
   size, heartbeat budget, same-room value conflict) arrives as an
   already-rejected promise, before any wire work or publisher-state
   change; the helper attaches its rejection handler at call time.
3. **Transport publish failure** — does not reject; surfaces as
   `publisher.status === 'publish-error'` per the shipped contract. The
   helper reports **each distinct observed publisher transition** into
   `publish-error`. Because that state is level-triggered and React may
   coalesce snapshots, multiple underlying wire failures can collapse into
   one observed transition; the guarantee is per observed transition, not
   per underlying occurrence, and the base hook is not modified to add
   occurrence counters.
4. **Withdrawal failure** — the base `delete()` rejection is caught and
   reported; this closes the shipped gap where a rejected withdrawal is
   invisible in publisher state (desired intent is cleared before the
   deletion settles, so the publisher reads `observing`).
5. **Lifecycle-observation failure** (Expo wrapper only) — a rejected
   resolver or a null source (unsupported host) is a terminal refusal for
   activity publication: reported once as a stable Expo activity
   diagnostic through `onError`/`lastError`, after which `touch()`
   declines admission permanently (`active` stays false) while peer
   observation continues per the base passthrough `status`. Under
   `SnapbackExpoProvider` the existing
   `SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED` boot refusal precedes
   children and this class is unreachable; the class exists for the
   bare-`SnapbackProvider` composition, where no boot owner refuses first.
   Silent deferral, publishing without an attached observer, and
   overriding the base passthrough state are all forbidden dispositions.

The default remains non-throwing (ephemeral state is lossy per LLP 0013)
but never unobservable. The helper adds no retry loop: after a
suspension/publish-error, the next `touch()` is an ordinary re-admitting
action, exactly as the demo behaves today; admission bounds (rate/size)
refuse before wire work.

Self-filtering removes only the granted connection's entry, controlled by
`excludeSelf` (default `true`; `false` keeps the self entry in `peers`).
Same-user other-device entries are a domain concept the helper cannot
identify; apps keep their one-line value-level filter (the guide example
shows it). A caller-supplied peer predicate is deferred.

### Expo: backgrounding and resume

The Expo binding pauses/resumes the provider on AppState transitions, and a
paused room retains its desired intent and republishes it once resumed and
ready — while JS timers do not run during OS suspension. Without care, a
minutes-old typing intent resurrects on foregrounding. The Expo arm of the
helper therefore treats **backgrounding as immediate withdrawal**, via a
pinned mechanism and a pinned doorway: **the `@expo/snapback-expo` facade
owns a wrapper hook** (exported under the same name, overriding the plain
re-export) that composes the React hook and observes the app lifecycle,
withdrawing its activity intent on the background transition (backgrounded
users are not typing).

**One shared lifecycle source.** The wrapper obtains its lifecycle source
exactly as the facade provider does: an injected `environment.appState` /
`environment.resolveAppState` (`SnapbackExpoEnvironmentV1`) wins, so hook
and provider always observe the same resolved source even in advanced
shells; only a tree with no injected source falls back to the facade's
default `#app-state` conditional resolver (which is also the fallback
under a bare `SnapbackProvider`).

**Gated admission during setup.** Lifecycle resolution is asynchronous, so
until observation is established (source resolved, listener attached, and
the then-current state sampled), the wrapper **defers admission**:
`touch()` evaluates the thunk at touch time as always and hands the
captured value to an **internal arm-with-captured-value seam** on the
React hook (private, not public API — the activity state machine stays in
the React package and the facade remains a thin composition); when
observation establishes, the seam admits the retained captured bytes
without re-evaluating the thunk, only if the app is then active and the
deadline is unexpired; if the sampled state is non-active, the wrapper
withdraws/declines instead. A resolution failure is error class 5. No intent can be published without
an attached observer, so a background transition — or a background/active
bounce — during listener setup has nothing to resurrect, and the
immediate-withdrawal guarantee is scoped to established observation.

The React package gains no platform-conditional code. An app that imports
the React package directly gets the absolute-deadline backstop only; the
messaging demo migration imports the facade hook so the demo demonstrates
the full Expo behavior. The wrapper is a valid thin composition and needs
no ordering against the provider's pause/resume lifecycle binding:
clearing the helper's intent is synchronous, and the guide's
one-lifecycle-binding rule governs provider pause/resume ownership — the
helper's listener withdraws only its own intent and pauses nothing. It also
works when an app mounts a bare `SnapbackProvider` without the lifecycle
binding at all (as the messaging demo does today). The absolute deadline is
the backstop: whenever the helper regains execution (resume, render,
room-ready), expired intent is withdrawn before new activity can be
admitted; if a provider resume republish races the backstop withdrawal
(pause landed before the listener's withdrawal completed), the transient
entry is removed by one fenced withdraw within the §D3 visibility bound.
No provider or wire change is required.

### Offline

Presence never enters the durable outbox (LLP 0013: ephemeral intent is
in-memory and never retained for offline replay). A disconnected `touch()`
creates provider-memory desired intent only: reconnecting before the idle
deadline may publish it; idle, unmount, disposal, or process loss prevents
any later replay.

## Deliverables

1. `useSnapbackActivityPresence` in the React binding (Expo binding
   re-exports it), implemented as a thin composition over
   `useSnapbackPresence` observer mode — no new room, subscription, or
   renewal machinery. The Expo arm adds the background-withdrawal wiring.
2. Guide update: `guide/realtime/ephemeral-state.md`'s typing example
   becomes a few-line use of the convenience (including the device-filter
   line), with the manual composition retained as the "how it works
   underneath" appendix.
3. Demo migration: the messaging demo — both `useTyping.ts` and the
   conversation screen's timer/clear choreography, which the hook absorbs.

## Non-goals

- No server-side idle detection; the server already owns TTL expiry and
  connection-scoped cleanup (LLP 0013). This is purely client choreography.
- No new ephemeral collection kinds, wire frames, or base-hook API changes.
- No headless/core twin in v1 — explicitly deferred until demand shows;
  `observeSnapbackPresence` is the existing seam a future
  `ActivityPublication` would mirror.
- Not a general activity/analytics tracker.

## Resolved and deferred questions

1. **Separate hook vs option bundle — resolved: separate hook.** An
   `activity` option on the base hook is not expressible as a mode of the
   shipped surface: declarative and imperative modes are mutually exclusive
   and the `PresenceState` union is closed; an option bundle would need a
   third mode plus new union arms. The base hook stays untouched.
2. **`touch(value?)` override — deferred.** Touch-time thunk evaluation
   covers the known cases; an override can be added compatibly if demand
   shows.
3. **Headless twin — deferred** (see Non-goals).
4. **Peer predicate option — deferred**; apps keep the explicit value-level
   device filter for now.
